import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { Source, sources } from "../core/contracts";
import { Mongo } from "../persistence/mongo.module";
import { SourceRepository } from "../persistence/source.repository";
import { Queues } from "../queue/queues.module";
import { Checkpoint, QuarantinedIssue, Run } from "./run.types";

const runInput = z
  .object({
    collections: z
      .array(z.enum(sources))
      .min(1)
      .max(3)
      .default([...sources]),
    limit: z.number().int().min(1).max(10000000).optional(),
  })
  .strict();

const errorsInput = z
  .object({
    after: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
    limit: z.coerce.number().int().min(1).max(100).default(25),
  })
  .strict();

@Injectable()
export class RunsService {
  constructor(
    @Inject(Mongo) private readonly mongo: Mongo,
    @Inject(SourceRepository) private readonly source: SourceRepository,
    @Inject(Queues) private readonly queues: Queues,
  ) {}

  async create(body: unknown) {
    const parsed = runInput.safeParse(body ?? {});
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    const input = parsed.data;

    const run: Run = {
      _id: randomUUID(),
      status: "running",
      startedAt: new Date(),
      dispatchDone: false,
      checkpoints: {},
      counters: { read: 0, transformed: 0, written: 0, skipped: 0, failed: 0 },
      errorSample: [],
    };
    if (input.limit !== undefined) run.limit = input.limit;

    for (const name of new Set(input.collections)) {
      run.checkpoints[name] = {
        upper: await this.source.upper(name),
        count: 0,
      };
    }

    await this.mongo.target.collection<Run>("runs").insertOne(run);
    try {
      await this.queues.dispatch.add(
        "dispatch",
        { runId: run._id },
        { jobId: run._id },
      );
    } catch (error) {
      await this.mongo.target.collection<Run>('runs').updateOne(
        { _id: run._id }, { $set: { status: 'failed', finishedAt: new Date() } },
      );
      throw error;
    }
    return run;
  }

  async get(id: string) {
    const run = await this.mongo.target
      .collection<Run>("runs")
      .findOne({ _id: id });
    if (!run) throw new NotFoundException("Run not found");
    return run;
  }

  async saveCheckpoint(runId: string, source: Source, checkpoint: Checkpoint) {
    await this.mongo.target.collection<Run>('runs').updateOne(
      { _id: runId },
      { $set: { [`checkpoints.${source}`]: checkpoint } },
    );
  }

  async markDispatchDone(runId: string) {
    await this.mongo.target.collection<Run>('runs').updateOne(
      { _id: runId },
      { $set: { dispatchDone: true } },
    );
  }

  async markDispatchFailed(runId: string, reason: string) {
    await this.mongo.target.collection<Run>('runs').updateOne(
      { _id: runId },
      { $set: { dispatchDone: true, dispatchFailed: true, dispatchError: reason } },
    );
  }

  async errors(id: string, query: unknown) {
    await this.get(id);
    const parsed = errorsInput.safeParse(query);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    const { after, limit } = parsed.data;

    const filter: { runId: string; _id?: { $gt: string } } = { runId: id };
    if (after) filter._id = { $gt: after };
    const rows = await this.mongo.target
      .collection<QuarantinedIssue>("quarantine")
      .find(filter)
      .sort({ _id: 1 })
      .limit(limit + 1)
      .toArray();
    const data = rows.slice(0, limit);
    const next = rows.length > limit ? data[data.length - 1]._id : null;
    return { data, next };
  }

  async finish(id: string) {
    const run = await this.get(id);
    if (run.status !== "running" || !run.dispatchDone) return;
    const pending = await this.mongo.target
      .collection("batches")
      .findOne({ runId: id, status: "pending" });
    if (pending) return;

    const dead = await this.mongo.target
      .collection("batches")
      .findOne({ runId: id, status: "dead" });
    const latest = await this.get(id);
    let status: Run["status"] = "completed";
    if (latest.counters.failed > 0) status = "completed_with_errors";
    if (dead || latest.dispatchFailed) status = "failed";

    const finishedAt = new Date();
    await this.mongo.target
      .collection<Run>("runs")
      .updateOne(
        { _id: id, status: "running" },
        {
          $set: {
            status,
            finishedAt,
            durationMs: finishedAt.getTime() - run.startedAt.getTime(),
          },
        },
      );
  }
}
