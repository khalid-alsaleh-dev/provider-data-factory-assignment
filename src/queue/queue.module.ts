import { Module } from "@nestjs/common";
import { ProvidersModule } from "../providers/providers.module";
import { PersistenceModule } from "../persistence/persistence.module";
import { RunsModule } from "../runs/runs.module";
import { QueueService } from "./queue.service";
import { QueuesModule } from "./queues.module";
import { Dispatcher } from "./dispatcher.service";
import { BatchProcessor } from "./batch-processor.service";
@Module({
  imports: [ProvidersModule, PersistenceModule, RunsModule, QueuesModule],
  providers: [QueueService, Dispatcher, BatchProcessor],
})
export class QueueModule {}
