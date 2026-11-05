import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Post,
  Query,
} from "@nestjs/common";
import { RunsService } from "./runs.service";
@Controller("runs")
export class RunsController {
  constructor(@Inject(RunsService) private readonly runs: RunsService) {}
  @Post() create(@Body() body: unknown) {
    return this.runs.create(body);
  }
  @Get(":id") get(@Param("id") id: string) {
    return this.runs.get(id);
  }
  @Get(":id/errors") errors(@Param("id") id: string, @Query() query: unknown) {
    return this.runs.errors(id, query);
  }
}
