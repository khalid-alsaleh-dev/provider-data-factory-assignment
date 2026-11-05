import { test } from 'node:test';
import assert from 'node:assert/strict';
import { envSchema } from '../src/config/config.module';
import { deduplicate, map, normalise, project, transform, validate } from '../src/core/pipeline';
import { digest, money, naturalId } from '../src/core/helpers';
import { Candidate } from '../src/core/contracts';
import { restaurantUrl, XbyteAdapter } from '../src/providers/xbyte/adapter';
import { applyMapping, mappings } from '../src/providers/xbyte/mapping';
import { safeError } from '../src/queue/queue.service';
import { listing, location, menu } from './fixtures';
const adapter = new XbyteAdapter();
const context = { source: 'menus' as const, sourceId: 'abc' };

test('validate and normalise reject invalid boundaries and clean whitespace without mutation', () => {
  const c: Candidate = { collection: 'locations', version: '1', path: '$', value: { providerId: '1', name: ' A\r\n B ' } };
  assert.equal(normalise(validate(c)).value.name, 'A B');
  assert.equal(c.value.name, ' A\r\n B ');
  assert.throws(() => validate({ ...c, value: null as any }));
});
test('mapping converts mixed IDs and prices; blank, fractional IDs and negative money fail', () => {
  assert.equal(naturalId('001468'), '1468');
  assert.equal(naturalId('009007199254740993'), '9007199254740993');
  for (const v of ['', null, {}, 1.5, 0, Number.MAX_SAFE_INTEGER + 1]) assert.throws(() => naturalId(v));
  assert.equal(money('57.25'), 5725);
  assert.equal(money('90071992547409.91'), Number.MAX_SAFE_INTEGER);
  assert.throws(() => money('90071992547409.92'));
  assert.throws(() => money('1.005')); // Reject sub-cent prices rather than silently rounding.
  for (const v of ['', null, '-1', 'NaN', 'Infinity']) assert.throws(() => money(v));
  assert.equal(applyMapping({ location_id: 1468, location_name: 'A' }, mappings.location).providerId, '1468');
  assert.equal(applyMapping({ price: 50.80000076293945 }, mappings.item).priceMinor, 5080);
  assert.throws(() => applyMapping({ price: 1.005 }, mappings.item));
  assert.throws(() => applyMapping({ price: -0.000001 }, mappings.item));
});
test('generic map and projection use natural keys and reject unknown or invalid target fields', () => {
  const c: Candidate = { collection: 'locations', version: '1', path: '$', value: { providerId: '7', name: 'A' } };
  assert.equal(project(map(c, 'another-provider')).key, 'another-provider/locations/7');
  assert.throws(() => project(map({ ...c, value: { ...c.value, unexpected: 1 } }, 'p')));
  assert.throws(() => project(map({ ...c, value: { providerId: '7', name: '' } }, 'p')));
});
test('deduplication is independent of candidate order; later version wins', () => {
  const a = { collection: 'locations' as const, key: 'p/locations/7', version: '1', data: { name: 'A' } };
  const b = { ...a, version: '2', data: { name: 'B' } };
  assert.deepEqual(deduplicate([a, b]), deduplicate([b, a]));
  assert.equal(deduplicate([a, b])[0].data.name, 'B');
  const first = project({ ...a, data: { providerId: '7', name: 'First' } });
  const second = project({ ...a, data: { providerId: '7', name: 'Second' } });
  assert.deepEqual(deduplicate([first, second]), deduplicate([second, first]));
  assert.equal(digest({ name: 'A', id: '7' }), digest({ id: '7', name: 'A' }));
  assert.equal(digest([{ name: 'A', id: '7' }]), digest([{ id: '7', name: 'A' }]));
  assert.notEqual(digest(['1', '2']), digest(['2', '1']));
});
test('location envelopes flatten and duplicate numeric/string IDs collapse', () => {
  const result = transform(adapter, location(), { source: 'locations', sourceId: 'x' });
  assert.equal(result.entities.length, 1);
  assert.equal(result.duplicates, 1);
  assert.equal(result.entities[0].data.name, 'Al Zaab');
});
test('restaurant URL identity ignores slugs and query parameters; area conflicts quarantine', () => {
  assert.deepEqual(restaurantUrl('https://www.talabat.com/uae/restaurant/123/a?aid=1468&tracking=x'), restaurantUrl('https://www.talabat.com/uae/restaurant/123/b?aid=1468'));
  assert.throws(() => restaurantUrl('https://evil.example/uae/restaurant/123/a'));
  const raw = listing(); raw.params.areaId = '999';
  const result = transform(adapter, raw, { source: 'restaurants', sourceId: 'x' });
  assert.equal(result.entities.length, 0); assert.equal(result.issues.length, 1);
});
test('HTTP 200 application failures are quarantined, never silently skipped', () => {
  const result = transform(adapter, { domain: 'talabat', statusCode: 200, payload: { Message: 'Not a restaurant page' } }, context);
  assert.equal(result.entities.length, 0); assert.match(result.issues[0].reason, /application error/);
  assert.equal(transform(adapter, { domain: 'unknown' }, context).issues.length, 1);
});
test('items are first class with multiple memberships, and transformation is pure and deterministic', () => {
  const raw = menu(), before = structuredClone(raw);
  const result = transform(adapter, raw, context);
  assert.equal(result.entities.filter(e => e.collection === 'items').length, 1);
  assert.equal(result.entities.filter(e => e.collection === 'category_items').length, 2);
  const restaurant = result.entities.find(e => e.collection === 'restaurants')!;
  assert.equal(restaurant.data.providerId, '123');
  assert.equal(restaurant.data.sourceRestaurantId, '9999');
  assert.deepEqual(result, transform(adapter, raw, context));
  const exported = { ...raw, updatedAt: { $date: raw.updatedAt.toISOString() } };
  assert.deepEqual(result, transform(adapter, exported, context));
  const badDate = { ...raw, updatedAt: { $date: null } };
  assert.equal(transform(adapter, badDate, context).entities.length, 0);
  assert.match(transform(adapter, badDate, context).issues[0].reason, /timestamp/);
  assert.deepEqual(raw, before); assert.equal(result.issues.length, 0);
});
test('bad nested items quarantine individually, leaving siblings usable and no dangling membership', () => {
  const raw = menu(); raw.payload.results[0].category[0].items[0].price = '-2';
  const result = transform(adapter, raw, context);
  assert.equal(result.issues.length, 1);
  assert.equal(result.entities.filter(e => e.collection === 'category_items').length, 1);
  assert.match(result.issues[0].path, /items.0/);
});
test('invalid coordinates and conflicting outlet IDs reject parents and children', () => {
  const raw = menu(); raw.payload.results[0].latitude = '999';
  assert.equal(transform(adapter, raw, context).entities.length, 0);
  raw.payload.results[0].latitude = '25'; raw.payload.results[0].outletCode = 999;
  assert.equal(transform(adapter, raw, context).entities.length, 0);
});
test('invalid category/item fields are quarantined without dangling links', () => {
  const badCategory = menu();
  badCategory.payload.results[0].category[0].category_name = '   ';
  const categoryResult = transform(adapter, badCategory, context);
  assert.equal(categoryResult.issues.length, 1);
  assert.equal(categoryResult.entities.filter(e => e.collection === 'categories').length, 1);
  assert.equal(categoryResult.entities.filter(e => e.collection === 'category_items').length, 1);

  const badItem = menu();
  badItem.payload.results[0].category[0].items[0].item_name = '   ';
  const itemResult = transform(adapter, badItem, context);
  assert.equal(itemResult.issues.length, 1);
  assert.equal(itemResult.entities.filter(e => e.collection === 'category_items').length, 1);

  const badImage = menu();
  Object.assign(badImage.payload.results[0].category[0].items[0], { image: 'not-a-url' });
  const imageResult = transform(adapter, badImage, context);
  assert.equal(imageResult.issues.length, 1);
  assert.equal(imageResult.entities.filter(e => e.collection === 'category_items').length, 1);
});

test('configuration fails early and operational errors redact credentials', () => {
  assert.equal(envSchema.safeParse({ RAW_DB: 'same', TARGET_DB: 'same' }).success, false);
  assert.equal(envSchema.safeParse({ WORKER_CONCURRENCY: '0' }).success, false);
  assert.equal(envSchema.safeParse({ REDIS_URL: 'https://example.com' }).success, false);
  assert.ok(!safeError(new Error('Connection to mongodb://user:secret@host/?key=secret failed')).includes('secret'));
});
