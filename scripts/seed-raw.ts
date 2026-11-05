import { createReadStream } from 'node:fs';
import { resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { parseArgs } from 'node:util';
import { BSON, Collection, Document, MongoClient } from 'mongodb';
import { parser } from 'stream-json';
import { streamArray } from 'stream-json/streamers/StreamArray';
import { envSchema } from '../src/config/config.module';
import { sources } from '../src/core/contracts';
import { XbyteAdapter } from '../src/providers/xbyte/adapter';

const BATCH_SIZE = 100;

async function saveBatch(collection: Collection, documents: Document[]): Promise<number> {
  if (documents.length === 0) return 0;

  await collection.bulkWrite(documents.map(doc => ({
    replaceOne: {
      filter: { _id: doc._id },
      replacement: doc,
      upsert: true,
    },
  })), { ordered: false });

  return documents.length;
}

async function seedFile(file: string, collection: Collection): Promise<number> {
  let batch: Document[] = [];
  let count = 0;

  await pipeline(createReadStream(file), parser(), streamArray(), async records => {
    for await (const { value } of records) {
      const doc = BSON.EJSON.deserialize(value);
      if (!(doc._id instanceof BSON.ObjectId)) {
        throw new Error('Source _id must be an Extended JSON ObjectId');
      }

      batch.push(doc);
      if (batch.length === BATCH_SIZE) {
        count += await saveBatch(collection, batch);
        batch = [];
      }
    }
    // Flush the final partial batch.
    count += await saveBatch(collection, batch);
  });

  return count;
}

async function main() {
  const config = envSchema.parse(process.env);
  const { values } = parseArgs({
    options: {
      dir: { type: 'string', default: 'data' },
      locations: { type: 'string' },
      restaurants: { type: 'string' },
      menus: { type: 'string' },
    },
  });
  const adapter = new XbyteAdapter();
  const client = new MongoClient(config.MONGO_URI);

  try {
    await client.connect();

    for (const source of sources) {
      const file = values[source] ?? resolve(values.dir, `compero-xbyte.xbyte-raw-${source}.json`);
      const collection = client.db(config.RAW_DB).collection(adapter.sourceCollections[source]);
      const count = await seedFile(file, collection);
      console.log(JSON.stringify({ event: 'seeded', source, count }));
    }
  } finally {
    await client.close();
  }
}

void main().catch(error => {
  console.error('Seed failed:', error.message);
  process.exitCode = 1;
});
