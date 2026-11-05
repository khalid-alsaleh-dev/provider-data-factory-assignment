import { Module } from '@nestjs/common';
import { SourceRepository } from './source.repository';
import { WorkRepository } from './work.repository';
import { ProvidersModule } from '../providers/providers.module';
@Module({ imports: [ProvidersModule], providers: [SourceRepository, WorkRepository], exports: [SourceRepository, WorkRepository] })
export class PersistenceModule {}
