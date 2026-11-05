import { Inject, Injectable } from '@nestjs/common';
import { Entity, Issue, Result, Source, WorkPort } from '../core/contracts';
import { digest } from '../core/helpers';
import { Batch, QuarantinedIssue, Run } from '../runs/run.types';
import { Mongo } from './mongo.module';

type StoredEntity = Record<string, unknown> & {
  _id: string;
  _version: string;
  provider: string;
};

@Injectable()
export class WorkRepository implements WorkPort {
  constructor(@Inject(Mongo) private readonly mongo: Mongo) {}

  async createBatch(runId: string, source: Source, ids: string[]): Promise<Batch> {
    const batch: Batch = {
      _id: digest([runId, source, ids]), runId, source, ids, status: 'pending',
    };
    await this.mongo.target.collection<Batch>('batches').updateOne(
      { _id: batch._id },
      { $setOnInsert: batch },
      { upsert: true },
    );
    return batch;
  }

  async getBatch(batchId: string): Promise<Batch> {
    const batch = await this.mongo.target.collection<Batch>('batches').findOne({ _id: batchId });
    if (!batch) throw new Error('Batch not found');
    return batch;
  }

  async process(runId: string, batchId: string, source: Source, sourceId: string, result: Result) {
    const receiptId = `${runId}/${source}/${sourceId}`;
    const receipts = this.mongo.target.collection<{ _id: string }>('receipts');
    if (await receipts.findOne({ _id: receiptId })) return;
    let written = 0;
    for (const entity of result.entities) written += await this.saveEntity(entity);
    await this.saveIssues(runId, batchId, source, sourceId, result.issues);
    await this.updateCounters(runId, result, written);
    // Mark finished last; a crash before this point may repeat counter updates.
    await receipts.updateOne({ _id: receiptId }, { $setOnInsert: { _id: receiptId } }, { upsert: true });
  }

  private async saveEntity(entity: Entity): Promise<number> {
    const collection = this.mongo.target.collection<StoredEntity>(entity.collection);
    const document: StoredEntity = {
      _id: entity.key,
      ...entity.data,
      provider: entity.key.split('/')[0],
      _version: entity.version,
    };

    // Insert a missing entity. An existing entity is left untouched here
    const inserted = await collection.updateOne(
      { _id: entity.key }, { $setOnInsert: document }, { upsert: true },
    );
    if (inserted.upsertedCount > 0) return 1;

    // Replace only an older version. The condition is checked by MongoDB.
    const updated = await collection.replaceOne(
      { _id: entity.key, _version: { $lt: entity.version } }, document,
    );
    return updated.modifiedCount;
  }

  private async saveIssues(runId: string, batchId: string, source: Source, sourceId: string, issues: Issue[]) {
    if (issues.length === 0) return;

    const quarantine = this.mongo.target.collection<QuarantinedIssue>('quarantine');
    for (let index = 0; index < issues.length; index++) {
      const issue = issues[index];
      const id = digest([runId, source, sourceId, index, issue]);
      await quarantine.updateOne(
        { _id: id },
        { $setOnInsert: { runId, batchId, source, sourceId, ...issue } },
        { upsert: true },
      );
    }

    const sample = issues.slice(0, 3).map(issue => ({ sourceId, ...issue }));
    await this.mongo.target.collection<Run>('runs').updateOne(
      { _id: runId }, { $set: { errorSample: sample } },
    );
  }

  private async updateCounters(runId: string, result: Result, written: number) {
    await this.mongo.target.collection<Run>('runs').updateOne({ _id: runId }, {
      $inc: {
        'counters.read': 1,
        'counters.transformed': result.entities.length > 0 ? 1 : 0,
        'counters.written': written,
        'counters.skipped': result.duplicates + result.entities.length - written,
        'counters.failed': result.issues.length,
      },
    });
  }

  async finishBatch(id: string) {
    await this.mongo.target.collection<Batch>('batches').updateOne(
      { _id: id, status: 'pending' },
      { $set: { status: 'completed', finishedAt: new Date() } },
    );
  }

  async deadLetter(batch: Batch, reason: string) {
    const current = await this.getBatch(batch._id);
    if (current.status !== 'pending') return;

    for (const sourceId of batch.ids) {
      await this.process(batch.runId, batch._id, batch.source, sourceId, {
        entities: [],
        duplicates: 0,
        issues: [{ path: '$', reason: `Retries exhausted: ${reason}` }],
      });
    }
    await this.mongo.target.collection<Batch>('batches').updateOne(
      { _id: batch._id, status: 'pending' },
      { $set: { status: 'dead', finishedAt: new Date() } },
    );
  }
}
