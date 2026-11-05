import { decimal, money, naturalId, text } from '../../core/helpers';

// Left: our field name. Right: the provider's field name.
export const mappings = {
  location: { providerId: 'location_id', name: 'location_name', slug: 'location_slug' },
  listing: { name: 'restaurant_name' },
  restaurant: {
    sourceRestaurantId: 'id', name: 'name', address: 'Restaurant Address', city: 'City',
    latitude: 'latitude', longitude: 'longitude', outletCode: 'outletCode',
  },
  category: { providerId: 'category_id', name: 'category_name' },
  item: {
    providerId: 'item_id', name: 'item_name', description: 'description',
    priceMinor: 'price', image: 'image',
  },
};

export function providerMoney(value: unknown): number {
  // Some exported prices contain float32 noise, such as 50.80000076293945.
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
    const rounded = Math.round(value * 100) / 100;
    if (Math.abs(value - rounded) <= 0.00001) return money(rounded.toFixed(2));
  }
  return money(value);
}

const converters: Record<string, (value: unknown) => unknown> = {
  providerId: naturalId,
  sourceRestaurantId: naturalId,
  outletCode: naturalId,
  name: text,
  latitude: decimal,
  longitude: decimal,
  priceMinor: providerMoney,
};

export function applyMapping(row: Record<string, unknown>, mapping: Record<string, string>) {
  const output: Record<string, unknown> = {};
  for (const [field, sourceField] of Object.entries(mapping)) {
    const value = row[sourceField];
    if (value === undefined || value === null) continue;

    const convert = converters[field];
    output[field] = convert ? convert(value) : value;
  }
  return output;
}
