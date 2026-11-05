import { Controller, Get, Inject, Module, ServiceUnavailableException } from '@nestjs/common';
import { Mongo } from '../persistence/mongo.module';
import { Queues, QueuesModule } from '../queue/queues.module';

@Controller('health')
class HealthController {
  constructor(
    @Inject(Mongo) private readonly mongo: Mongo,
    @Inject(Queues) private readonly queues: Queues,
  ) {}

  @Get()
  async get() {
    let timer: NodeJS.Timeout | undefined;
    try {
      const checks = Promise.all([
        this.mongo.raw.command({ ping: 1 }),
        this.mongo.target.command({ ping: 1 }),
        this.queues.redis.ping(),
      ]);
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Health timeout')), 3000);
      });

      await Promise.race([checks, timeout]);
      return { status: 'ok', mongo: 'up', redis: 'up' };
    } catch {
      throw new ServiceUnavailableException({ status: 'degraded' });
    } finally {
      clearTimeout(timer);
    }
  }
}

@Module({ imports: [QueuesModule], controllers: [HealthController] })
export class HealthModule {}
