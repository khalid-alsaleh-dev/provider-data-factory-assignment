import { Inject, Injectable, Module, OnApplicationShutdown } from '@nestjs/common';
import { Queue } from 'bullmq';
import Redis from 'ioredis';
import { CONFIG, Config } from '../config/config.module';

@Injectable()
export class Queues implements OnApplicationShutdown {
  readonly redis: Redis;
  readonly dispatch: Queue;
  readonly batches: Queue;
  readonly deadLetters: Queue;

  constructor(@Inject(CONFIG) config: Config) {
    this.redis = new Redis(config.REDIS_URL, { maxRetriesPerRequest: null });
    const options = {
      connection: this.redis,
      defaultJobOptions: {
        attempts: config.JOB_ATTEMPTS,
        backoff: { type: 'exponential', delay: config.BACKOFF_MS },
        // Retain job IDs so a dispatcher retry cannot enqueue duplicates.
        removeOnComplete: false,
        removeOnFail: false,
      },
    };
    this.dispatch = new Queue('factory-dispatch', options);
    this.batches = new Queue('factory-batches', options);
    this.deadLetters = new Queue('factory-dead-letters', { connection: this.redis });
  }

  async onApplicationShutdown() {
    await this.dispatch.close();
    await this.batches.close();
    await this.deadLetters.close();
    await this.redis.quit();
  }
}

@Module({ providers: [Queues], exports: [Queues] })
export class QueuesModule {}
