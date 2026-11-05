import { Module } from '@nestjs/common';
import { XbyteAdapter } from './xbyte/adapter';
export const ADAPTER = Symbol('ADAPTER');
@Module({ providers: [{ provide: ADAPTER, useClass: XbyteAdapter }], exports: [ADAPTER] })
export class ProvidersModule {}
