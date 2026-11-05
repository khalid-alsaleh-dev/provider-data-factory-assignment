import { Module } from '@nestjs/common';
import { ConfigModule } from './config/config.module';
import { MongoModule } from './persistence/mongo.module';
import { RunsModule } from './runs/runs.module';
import { QueueModule } from './queue/queue.module';
import { HealthModule } from './health/health.module';
@Module({ imports: [ConfigModule, MongoModule, RunsModule, QueueModule, HealthModule] })
export class AppModule {}
