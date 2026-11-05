import { Global, Inject, Injectable, Module, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { Db, MongoClient } from 'mongodb';
import { Config, CONFIG } from '../config/config.module';

@Injectable()
export class Mongo implements OnModuleInit, OnApplicationShutdown {
  readonly client: MongoClient;
  readonly raw: Db;
  readonly target: Db;
  constructor(@Inject(CONFIG) config: Config) {
    this.client = new MongoClient(config.MONGO_URI, { serverSelectionTimeoutMS: 5000 });
    this.raw = this.client.db(config.RAW_DB);
    this.target = this.client.db(config.TARGET_DB);
  }
  async onModuleInit() {
    await this.client.connect();
    await Promise.all([
      this.target.collection('service_areas').createIndex({ locationKey: 1, restaurantKey: 1 }),
      this.target.collection('categories').createIndex({ restaurantKey: 1 }),
      this.target.collection('items').createIndex({ restaurantKey: 1 }),
      this.target.collection('category_items').createIndex({ categoryKey: 1, itemKey: 1 }),
      this.target.collection('category_items').createIndex({ itemKey: 1 }),
      this.target.collection('quarantine').createIndex({ runId: 1, _id: 1 }),
      this.target.collection('batches').createIndex({ runId: 1, status: 1 }),
      this.target.collection('runs').createIndex({ status: 1 }),
    ]);
  }
  async onApplicationShutdown() { await this.client.close(); }
}
@Global()
@Module({ providers: [Mongo], exports: [Mongo] })
export class MongoModule {}
