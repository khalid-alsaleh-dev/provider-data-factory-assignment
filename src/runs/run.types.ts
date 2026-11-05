import { Issue, Source } from '../core/contracts';

export interface QuarantinedIssue extends Issue {
  _id: string;
  runId: string;
  batchId: string;
  source: Source;
  sourceId: string;
}

export interface Checkpoint {
  upper?: string;
  after?: string;
  count: number;
  done?: boolean;
}

export interface Run {
  _id: string;
  status: 'running' | 'completed' | 'completed_with_errors' | 'failed';
  startedAt: Date;
  finishedAt?: Date;
  durationMs?: number;
  dispatchDone: boolean;
  dispatchFailed?: boolean;
  dispatchError?: string;
  limit?: number;
  checkpoints: Partial<Record<Source, Checkpoint>>;
  counters: { read: number; transformed: number; written: number; skipped: number; failed: number };
  errorSample: { sourceId: string; path: string; reason: string }[];
}

export interface Batch {
  _id: string;
  runId: string;
  source: Source;
  ids: string[];
  status: 'pending' | 'completed' | 'dead';
  finishedAt?: Date;
}
