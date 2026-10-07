/**
 * GAP-ANALYTICS-AI-INSIGHTS-03: confidence arrives as a display string
 * ("84%", "n/a", ""). The old average did `parseInt(c,10) || 0` which counted
 * every unparsable value as 0 in the numerator while keeping it in the
 * denominator, dragging the mean down. Parse strictly and average only the
 * values we could actually read.
 */

/** Parse a confidence display string to a 0–100 number, or null if unreadable. */
export function parseConfidence(raw: string | null | undefined): number | null {
  if (raw == null) return null;
  const match = String(raw).match(/-?\d+(\.\d+)?/);
  if (!match) return null;
  const n = Number(match[0]);
  if (!Number.isFinite(n)) return null;
  return Math.min(100, Math.max(0, n));
}

/**
 * Mean of the readable confidence values, rounded. Returns null when no row
 * has a parseable confidence (caller renders "—"), never a misleading 0.
 */
export function averageConfidence(rawValues: Array<string | null | undefined>): number | null {
  const nums = rawValues.map(parseConfidence).filter((n): n is number => n !== null);
  if (nums.length === 0) return null;
  return Math.round(nums.reduce((s, n) => s + n, 0) / nums.length);
}
