/**
 * Parse a user-supplied `?limit=` into a safe positive integer.
 * Non-numeric, non-finite or < 1 input falls back to `fallback`; anything above
 * `max` is capped. (CLOS-S5-02/03: a bare Number() gave NaN / negatives that
 * 500ed in SQL LIMIT or silently truncated an in-memory slice.)
 */
export function clampLimit(raw: unknown, fallback: number, max: number): number {
  const n = Math.trunc(Number(raw));
  return Number.isFinite(n) && n > 0 ? Math.min(n, max) : fallback;
}
