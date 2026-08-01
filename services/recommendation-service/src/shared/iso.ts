/**
 * Timestamp serialisation helper.
 *
 * WHY this exists: rows are read through `cache.getOrLoad`, which stores them as
 * JSON. A `Date` survives the first (cache-miss) call but comes back as an ISO
 * STRING on every cache hit, even though the row type still says `Date`. Calling
 * `.toISOString()` directly therefore works on a cold cache and throws
 * "toISOString is not a function" on a warm one — a bug that only shows up under
 * load. Everything that serialises a timestamp for a response goes through here.
 */
export function toIso(value: Date | string | number): string {
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toISOString();
}
