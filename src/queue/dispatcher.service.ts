import { Inject, Injectable } from '@nestjs/common';
import { Config, CONFIG } from '../config/config.module';
import { Source, sources } from '../core/contracts';
import { SourceRepository } from '../persistence/source.repository';
import { WorkRepository } from '../persistence/work.repository';
import { RunsService } from '../runs/runs.service';
import { Checkpoint, Run } from '../runs/run.types';
import { Queues } from './queues.module';

@Injectable()
export class Dispatcher {
  private stopping = false;

  constructor(
    @Inject(CONFIG) private readonly config: Config,
    @Inject(SourceRepository) private readonly source: SourceRepository,
    @Inject(WorkRepository) private readonly work: WorkRepository,
    @Inject(RunsService) private readonly runs: RunsService,
    @Inject(Queues) private readonly queues: Queues,
  ) {}

  async dispatch(runId: string) {
    const run = await this.runs.get(runId);
    if (run.status !== 'running' || run.dispatchDone) return;

    for (const collection of sources) {
      const checkpoint = run.checkpoints[collection];
      if (!checkpoint) continue; // This collection was not selected.
      await this.dispatchCollection(run, collection, checkpoint);
    }

    await this.runs.markDispatchDone(runId);
    await this.runs.finish(runId);
  }

  private async dispatchCollection(run: Run, collection: Source, checkpoint: Checkpoint) {
    if (checkpoint.done || !checkpoint.upper) return;

    let batchSize = this.getBatchSize(run, checkpoint);
    while (batchSize > 0) {
      if (this.stopping) throw new Error('Dispatcher shutting down');

      const ids = await this.source.page(collection, checkpoint.after, checkpoint.upper, batchSize);
      if (ids.length === 0) break;

      const batch = await this.work.createBatch(run._id, collection, ids);
      await this.queues.batches.add(
        'batch',
        { batchId: batch._id, runId: run._id },
        { jobId: batch._id },
      );

      // Save progress after enqueueing. Retrying uses the same batch/job ID.
      checkpoint.after = ids[ids.length - 1];
      checkpoint.count += ids.length;
      await this.runs.saveCheckpoint(run._id, collection, checkpoint);
      batchSize = this.getBatchSize(run, checkpoint);
    }

    checkpoint.done = true;
    await this.runs.saveCheckpoint(run._id, collection, checkpoint);
  }

  private getBatchSize(run: Run, checkpoint: Checkpoint): number {
    if (run.limit === undefined) return this.config.BATCH_SIZE;

    const remaining = run.limit - checkpoint.count;
    return Math.min(this.config.BATCH_SIZE, remaining);
  }

  stop() {
    this.stopping = true;
  }
}
