import { Module } from "@nestjs/common";
import { PersistenceModule } from "../persistence/persistence.module";
import { RunsController } from "./runs.controller";
import { RunsService } from "./runs.service";
import { QueuesModule } from '../queue/queues.module';
@Module({
  imports: [PersistenceModule, QueuesModule],
  controllers: [RunsController],
  providers: [RunsService],
  exports: [RunsService],
})
export class RunsModule {}
