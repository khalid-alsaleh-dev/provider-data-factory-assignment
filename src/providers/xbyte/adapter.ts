import { z } from 'zod';
import { Adapter, Candidate, Collection, Context, Issue, Source } from '../../core/contracts';
import { naturalId } from '../../core/helpers';
import { schemas } from '../../core/schemas';
import { applyMapping, mappings } from './mapping';

type Row = Record<string, any>;
const rowSchema = z.record(z.unknown());
const envelope = z.object({
  domain: z.literal('talabat'),
  statusCode: z.coerce.number().int(),
  payload: z.record(z.unknown()),
  params: z.record(z.unknown()).optional(),
}).passthrough();

export function restaurantUrl(value: unknown) {
  const url = new URL(String(value));
  if (url.protocol !== 'https:' || url.hostname !== 'www.talabat.com' || url.username || url.password) {
    throw new Error('Invalid Talabat restaurant URL');
  }
  const match = url.pathname.match(/^\/uae\/restaurant\/(\d+)(?:\/|$)/);
  if (!match) throw new Error('Missing restaurant ID in URL');
  const id = naturalId(match[1]);
  const area = url.searchParams.has('aid') ? naturalId(url.searchParams.get('aid')) : undefined;
  return { id, area, url: `https://www.talabat.com/uae/restaurant/${id}` };
}

export class XbyteAdapter implements Adapter {
  readonly name = 'xbyte-talabat';
  readonly sourceCollections: Record<Source, string> = {
    locations: 'xbyte-raw-locations', restaurants: 'xbyte-raw-restaurants', menus: 'xbyte-raw-menus',
  };

  extract(raw: unknown, context: Context) {
    const candidates: Candidate[] = [];
    const issues: Issue[] = [];
    try {
      const doc = envelope.parse(raw) as Row;
      this.validateEnvelope(doc);
      const version = this.getVersion(doc, context);

      for (const [index, input] of doc.payload.results.entries()) {
        const path = `results.${index}`;
        try {
          const row = rowSchema.parse(input);
          if (context.source === 'locations') {
            candidates.push(this.candidate('locations', applyMapping(row, mappings.location), path, version));
          } else if (context.source === 'restaurants') {
            candidates.push(...this.readListing(row, doc, path, version));
          } else {
            candidates.push(...this.readMenu(row, doc, path, version, issues));
          }
        } catch (error) {
          issues.push(this.issue(path, error));
        }
      }
    } catch (error) {
      issues.push(this.issue('$', error));
    }
    return { candidates, issues };
  }

  private validateEnvelope(doc: Row) {
    const payload = doc.payload;
    const responseStatus = payload.request_log?.statusCode;
    if (doc.statusCode !== 200 || (responseStatus !== undefined && Number(responseStatus) !== 200)) {
      throw new Error('Provider HTTP failure');
    }
    if (payload.Message || payload.error || payload['Page Error Message']) {
      throw new Error('Provider returned an application error');
    }
    if (!Array.isArray(payload.results)) throw new Error('Missing results array');
  }

  private getVersion(doc: Row, context: Context): string {
    let stamp = doc.updatedAt ?? doc.createdAt ?? '1970-01-01T00:00:00.000Z';
    stamp = stamp.$date ?? stamp;
    const date = new Date(stamp);
    if (!Number.isFinite(date.getTime())) throw new Error('Invalid source timestamp');
    const priority = context.source === 'menus' ? '2' : '1';
    return `${priority}/${date.toISOString()}/${context.sourceId}`;
  }

  private readListing(row: Row, doc: Row, path: string, version: string): Candidate[] {
    const identity = restaurantUrl(row.restaurant_url);
    const area = naturalId(doc.params?.areaId);
    if (identity.area && area !== identity.area) throw new Error('Conflicting listing area and URL aid');

    return [
      this.candidate('restaurants', {
        ...applyMapping(row, mappings.listing), providerId: identity.id, url: identity.url,
      }, path, version),
      this.candidate('service_areas', {
        restaurantKey: this.key('restaurants', identity.id), locationKey: this.key('locations', area),
      }, path, version),
    ];
  }

  private readMenu(row: Row, doc: Row, path: string, version: string, issues: Issue[]): Candidate[] {
    const identity = restaurantUrl(doc.params?.restaurant_url);
    naturalId(row.id);
    if (row.outletCode !== undefined && naturalId(row.outletCode) !== identity.id) {
      throw new Error('Menu outlet code disagrees with URL');
    }
    if (!Array.isArray(row.category)) throw new Error('Missing category array');

    const restaurantKey = this.key('restaurants', identity.id);
    const candidates = [this.candidate('restaurants', {
      ...applyMapping(row, mappings.restaurant), providerId: identity.id, url: identity.url,
    }, path, version)];
    if (identity.area) {
      candidates.push(this.candidate('service_areas', {
        restaurantKey, locationKey: this.key('locations', identity.area),
      }, path, version));
    }

    for (const [index, input] of row.category.entries()) {
      const categoryPath = `${path}.category.${index}`;
      try {
        candidates.push(...this.readCategory(rowSchema.parse(input), identity.id, categoryPath, version, issues));
      } catch (error) {
        issues.push(this.issue(categoryPath, error));
      }
    }
    return candidates;
  }

  private readCategory(row: Row, restaurantId: string, path: string, version: string, issues: Issue[]): Candidate[] {
    const categoryId = naturalId(row.category_id);
    if (!Array.isArray(row.items)) throw new Error('Missing items array');
    const restaurantKey = this.key('restaurants', restaurantId);
    const categoryKey = this.key('categories', restaurantId, categoryId);
    const candidates = [this.candidate('categories', {
      ...applyMapping(row, mappings.category), restaurantKey,
    }, path, version)];

    for (const [index, input] of row.items.entries()) {
      const itemPath = `${path}.items.${index}`;
      try {
        const mapped = applyMapping(rowSchema.parse(input), mappings.item);
        candidates.push(
          this.candidate('items', { ...mapped, restaurantKey, currency: 'AED' }, itemPath, version),
          this.candidate('category_items', { categoryKey, itemKey: this.key('items', restaurantId, naturalId(mapped.providerId)) }, itemPath, version),
        );
      } catch (error) {
        issues.push(this.issue(itemPath, error));
      }
    }
    return candidates;
  }

  private key(collection: string, ...ids: string[]): string {
    return [this.name, collection, ...ids].join('/');
  }

  private candidate(collection: Collection, value: Row, path: string, version: string): Candidate {
    // Validate before emitting links, so rejected parents/items leave no dangling links.
    const valid = schemas[collection].strict().parse(value);
    return { collection, value: valid, path, version };
  }

  private issue(path: string, error: unknown): Issue {
    if (error instanceof z.ZodError) {
      const first = error.issues[0];
      return { path, reason: `${first.path.join('.')}: ${first.message}` };
    }
    return { path, reason: error instanceof Error ? error.message : 'Invalid provider data' };
  }
}
