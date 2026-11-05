import { Inject, Injectable } from "@nestjs/common";
import { ObjectId } from "mongodb";
import { Adapter, Source, SourcePort } from "../core/contracts";
import { ADAPTER } from "../providers/providers.module";
import { Mongo } from "./mongo.module";
@Injectable()
export class SourceRepository implements SourcePort {
  constructor(
    @Inject(Mongo) private readonly mongo: Mongo,
    @Inject(ADAPTER) private readonly adapter: Adapter,
  ) {}

  async upper(source: Source): Promise<string | undefined> {
    const collection = this.mongo.raw.collection(
      this.adapter.sourceCollections[source],
    );
    const doc = await collection
      .find({}, { projection: { _id: 1 } })
      .sort({ _id: -1 })
      .limit(1)
      .next();
    return doc?._id.toHexString();
  }

  async page(
    source: Source,
    after: string | undefined,
    upper: string,
    limit: number,
  ): Promise<string[]> {
    const idRange: { $gt?: ObjectId; $lte: ObjectId } = {
      $lte: new ObjectId(upper),
    };
    if (after) idRange.$gt = new ObjectId(after);

    const collection = this.mongo.raw.collection(
      this.adapter.sourceCollections[source],
    );
    const cursor = collection
      .find({ _id: idRange }, { projection: { _id: 1 } })
      .sort({ _id: 1 })
      .limit(limit)
      .batchSize(limit);

    const ids: string[] = [];
    try {
      for await (const row of cursor) ids.push(row._id.toHexString());
    } finally {
      await cursor.close();
    }
    return ids;
  }

  async get(source: Source, ids: string[]): Promise<Record<string, unknown>[]> {
    const objectIds = ids.map((id) => new ObjectId(id));
    const collection = this.mongo.raw.collection(
      this.adapter.sourceCollections[source],
    );
    const cursor = collection
      .find({ _id: { $in: objectIds } })
      .batchSize(ids.length);
    const docs: Record<string, unknown>[] = [];
    try {
      for await (const row of cursor) docs.push(row);
    } finally {
      await cursor.close();
    }
    return docs;
  }
}
