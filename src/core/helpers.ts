import { createHash } from 'node:crypto';

export function text(value: unknown) {
  if (typeof value !== 'string') return '';
  return value.normalize('NFKC').replace(/\s+/gu, ' ').trim();
}

export function naturalId(value: unknown) {
  if (typeof value === 'number' && !Number.isSafeInteger(value)) {
    throw new Error('Invalid provider ID');
  }
  const id = numberText(value).replace(/^0+/, '');
  if (!/^[1-9]\d*$/.test(id)) throw new Error('Invalid provider ID');
  return id;
}

export function decimal(value: unknown) {
  const number = Number(numberText(value));
  if (!Number.isFinite(number)) throw new Error('Expected finite decimal');
  return number;
}

export function money(value: unknown) {
  const amount = numberText(value);
  if (!/^\d+(?:\.\d{1,2})?$/.test(amount)) {
    throw new Error('Expected nonnegative price with at most two decimal places');
  }

  // "57.25" -> "57" + "25" -> 5725 fils. No floating-point multiplication.
  const [whole, fraction = ''] = amount.split('.');
  const minorUnits = Number(whole + fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(minorUnits)) throw new Error('Price exceeds safe range');
  return minorUnits;
}

// Sorted object keys give the same hash even if property order differs.
export function digest(value: unknown) {
  return createHash('sha256').update(stableJson(value)).digest('hex');
}

// Shared input check for the three number/ID helpers above.
function numberText(value: unknown) {
  if (typeof value !== 'number' && typeof value !== 'string') {
    throw new Error('Expected a number or numeric string');
  }
  const result = String(value).trim();
  if (result === '') throw new Error('Expected a number or numeric string');
  return result;
}

// Internal JSON helper: sort object keys before hashing, keeping array order.
function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    const items: string[] = [];
    for (const item of value) items.push(stableJson(item));
    return `[${items.join(',')}]`;
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(value).sort((a, b) => a.localeCompare(b, 'en'));
    const fields: string[] = [];
    for (const key of keys) {
      fields.push(`${JSON.stringify(key)}:${stableJson(record[key])}`);
    }
    return `{${fields.join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}
