import { Inject, Injectable, Logger } from '@nestjs/common';
import { Adapter, Result } from '../core/contracts';
import { transform } from '../core/pipeline';
import { SourceRepository } from '../persistence/source.repository';
import { WorkRepository } from '../persistence/work.repository';
import { ADAPTER } from '../providers/providers.module';
import { RunsService } from '../runs/runs.service';

@Injectable()
export class BatchProcessor {
  private readonly logger = new Logger('BatchProcessor');

  constructor(
    @Inject(SourceRepository) private readonly source: SourceRepository,
    @Inject(WorkRepository) private readonly work: WorkRepository,
    @Inject(ADAPTER) private readonly adapter: Adapter,
    @Inject(RunsService) private readonly runs: RunsService,
  ) {}

  async process(batchId: string, jobId?: string) {
    const batch = await this.work.getBatch(batchId);
    if (batch.status !== 'pending') return;

    const documents = await this.source.get(batch.source, batch.ids);
    const documentsById = new Map(documents.map(document => [String(document._id), document]));

    for (const sourceId of batch.ids) {
      const raw = documentsById.get(sourceId);
      let result: Result;
      if (raw) {
        result = transform(this.adapter, raw, { source: batch.source, sourceId });
      } else {
        result = {
          entities: [],
          duplicates: 0,
          issues: [{ path: '$', reason: 'Source document is missing' }],
        };
      }

      await this.work.process(batch.runId, batchId, batch.source, sourceId, result);
      this.logger.log({ event: 'document_processed', runId: batch.runId, jobId, sourceId });
    }

    await this.work.finishBatch(batchId);
    await this.runs.finish(batch.runId);
  }
}
