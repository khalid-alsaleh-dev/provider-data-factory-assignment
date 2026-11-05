import { Inject, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { Job, Worker } from 'bullmq';
import { Config, CONFIG } from '../config/config.module';
import { WorkRepository } from '../persistence/work.repository';
import { RunsService } from '../runs/runs.service';
import { BatchProcessor } from './batch-processor.service';
import { Dispatcher } from './dispatcher.service';
import { Queues } from './queues.module';

export function safeError(error: unknown): string {
  if (!(error instanceof Error)) return 'Unknown error';
  return `${error.name}: ${error.message}`
    .replace(/(?:mongodb(?:\+srv)?|rediss?|https?):\/\/\S+/gi, '[redacted-url]')
    .slice(0, 500);
}

@Injectable()
export class QueueService implements OnApplicationBootstrap, OnModuleDestroy {
  private workers: Worker[] = [];
  private readonly logger = new Logger('Workers');

  constructor(
    @Inject(CONFIG) private readonly config: Config,
    @Inject(Queues) private readonly queues: Queues,
    @Inject(Dispatcher) private readonly dispatcher: Dispatcher,
    @Inject(BatchProcessor) private readonly processor: BatchProcessor,
    @Inject(WorkRepository) private readonly work: WorkRepository,
    @Inject(RunsService) private readonly runs: RunsService,
  ) {}

  onApplicationBootstrap() {
    const dispatchWorker = new Worker(
      'factory-dispatch',
      job => this.dispatcher.dispatch(job.data.runId),
      { connection: this.queues.redis, concurrency: 1 },
    );
    const batchWorker = new Worker(
      'factory-batches',
      job => this.processor.process(job.data.batchId, job.id),
      { connection: this.queues.redis, concurrency: this.config.WORKER_CONCURRENCY },
    );
    this.workers = [dispatchWorker, batchWorker];

    for (const worker of this.workers) {
      worker.on('error', error => this.logger.error(safeError(error)));
      worker.on('failed', (job, error) => {
        if (!job) return;
        void this.handleFailure(job, error).catch(error => this.logger.error(safeError(error)));
      });
    }
  }

  private async handleFailure(job: Job, error: Error) {
    this.logger.warn({ runId: job.data.runId, jobId: job.id, error: safeError(error) });
    // Retryable jobs are waiting/delayed. Handle only terminal failure here.
    if (await job.getState() !== 'failed') return;

    if (job.name === 'dispatch') {
      await this.runs.markDispatchFailed(job.data.runId, safeError(error));
    } else {
      const batch = await this.work.getBatch(job.data.batchId);
      await this.work.deadLetter(batch, safeError(error));
      await this.queues.deadLetters.add('exhausted', {
        runId: batch.runId, batchId: batch._id, source: batch.source, sourceIds: batch.ids,
      }, { jobId: batch._id });
    }

    await this.runs.finish(job.data.runId);
  }

  async onModuleDestroy() {
    this.dispatcher.stop();
    for (const worker of this.workers) await worker.close();
  }
}
