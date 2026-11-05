export const sources = ['locations', 'restaurants', 'menus'] as const;
export type Source = typeof sources[number];

export const collections = ['locations', 'restaurants', 'service_areas', 'categories', 'items', 'category_items'] as const;
export type Collection = typeof collections[number];

export interface Context { source: Source; sourceId: string }
export interface Entity { collection: Collection; key: string; version: string; data: Record<string, unknown> }
export interface Issue { path: string; reason: string }
export interface Result { entities: Entity[]; issues: Issue[]; duplicates: number }

export interface Adapter {
  readonly name: string;
  readonly sourceCollections: Record<Source, string>;
  extract(raw: unknown, context: Context): { candidates: Candidate[]; issues: Issue[] };
}

export interface Candidate { collection: Collection; path: string; value: Record<string, unknown>; version: string }
export interface SourcePort {
  page(source: Source, after: string | undefined, upper: string, limit: number): Promise<string[]>;
  get(source: Source, ids: string[]): Promise<Record<string, unknown>[]>;
}
export interface WorkPort {
  process(runId: string, batchId: string, source: Source, sourceId: string, result: Result): Promise<void>;
}
