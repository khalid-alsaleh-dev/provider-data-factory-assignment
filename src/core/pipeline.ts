import { z } from 'zod';
import { Adapter, Candidate, Context, Entity, Result } from './contracts';
import { digest, text } from './helpers';
import { schemas } from './schemas';

export function transform(adapter: Adapter, raw: unknown, context: Context): Result {
  const extracted = adapter.extract(raw, context);
  const validEntities: Entity[] = [];
  const issues = [...extracted.issues];

  for (const candidate of extracted.candidates) {
    try {
      const valid = validate(candidate);
      const cleaned = normalise(valid);
      const entity = map(cleaned, adapter.name);
      validEntities.push(project(entity));
    } catch (error) {
      let reason = error instanceof Error ? error.message : 'Invalid candidate';
      if (error instanceof z.ZodError) {
        const first = error.issues[0];
        reason = `${first.path.join('.')}: ${first.message}`;
      }
      issues.push({ path: candidate.path, reason });
    }
  }

  const entities = deduplicate(validEntities);
  return { entities, issues, duplicates: validEntities.length - entities.length };
}

export function validate(candidate: Candidate): Candidate {
  if (!candidate.value || typeof candidate.value !== 'object' || Array.isArray(candidate.value)) {
    throw new Error('Expected entity object');
  }
  return candidate;
}

export function normalise(candidate: Candidate): Candidate {
  const value: Record<string, unknown> = {};
  for (const [field, item] of Object.entries(candidate.value)) {
    value[field] = typeof item === 'string' ? text(item) : item;
  }
  return { ...candidate, value };
}

export function map(candidate: Candidate, provider: string): Entity {
  const value = candidate.value;
  let identity = String(value.providerId);
  if (candidate.collection === 'categories' || candidate.collection === 'items') {
    const restaurantId = String(value.restaurantKey).split('/').at(-1);
    identity = `${restaurantId}/${value.providerId}`;
  }
  if (candidate.collection === 'service_areas') {
    identity = `${value.restaurantKey}/${value.locationKey}`;
  }
  if (candidate.collection === 'category_items') {
    identity = `${value.categoryKey}/${value.itemKey}`;
  }
  return {
    collection: candidate.collection,
    key: `${provider}/${candidate.collection}/${identity}`,
    version: candidate.version,
    data: value,
  };
}

export function project(entity: Entity): Entity {
  const data = schemas[entity.collection].strict().parse(entity.data);
  // Add the content tie-break once; deduplication and persistence compare this version.
  const version = `${entity.version}/${digest(data)}`;
  return { ...entity, data, version };
}

// Called after projection, so versions already include the deterministic content hash.
export function deduplicate(entities: Entity[]): Entity[] {
  const unique = new Map<string, Entity>();
  for (const entity of entities) {
    const existing = unique.get(entity.key);
    if (!existing || entity.version > existing.version) {
      unique.set(entity.key, entity);
    }
  }
  return [...unique.values()].sort((a, b) => a.key < b.key ? -1 : 1);
}
