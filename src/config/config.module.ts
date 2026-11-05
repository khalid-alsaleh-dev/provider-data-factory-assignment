import { Global, Module } from '@nestjs/common';
import { z } from 'zod';

const positive = (value: number, max: number) => z.coerce.number().int().min(1).max(max).default(value);
export const envSchema = z.object({
  MONGO_URI: z.string().url().refine(v => /^mongodb(?:\+srv)?:/.test(v), 'Expected MongoDB URI').default('mongodb://localhost:27017'),
  RAW_DB: z.string().regex(/^[\w-]+$/).default('provider_raw'),
  TARGET_DB: z.string().regex(/^[\w-]+$/).default('provider_domain'),
  REDIS_URL: z.string().url().refine(v => /^rediss?:/.test(v), 'Expected redis(s) URL').default('redis://localhost:6379'),
  PORT: positive(3000, 65535), BATCH_SIZE: positive(5, 100), WORKER_CONCURRENCY: positive(2, 32),
  JOB_ATTEMPTS: positive(3, 20), BACKOFF_MS: positive(1000, 60000),
}).refine(v => v.RAW_DB !== v.TARGET_DB, 'Raw and target databases must differ');
export type Config = z.infer<typeof envSchema>;
export const CONFIG = Symbol('CONFIG');
@Global()
@Module({ providers: [{ provide: CONFIG, useFactory: () => envSchema.parse(process.env) }], exports: [CONFIG] })
export class ConfigModule {}
