/**
 * GAP-PAYROLL-HOME-01: integer-paise helpers for the payroll money screens.
 *
 * payroll-service sends every run total as an integer-paise STRING next to its
 * legacy rupee float (grossMinor / netMinor / deductionsMinor). Screens parse
 * that string once into a bigint, do their arithmetic on bigints (no floating
 * point), and render with formatMoney at the display edge. A missing or
 * malformed value is "unknown" (null), never a fabricated zero.
 */

/** An integer-paise value (bigint string / integer number / bigint) as a bigint; null when missing or not an integer. */
export function parseMinor(value: string | number | bigint | null | undefined): bigint | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "bigint") return value;
  if (typeof value === "number") return Number.isSafeInteger(value) ? BigInt(value) : null;
  const trimmed = value.trim();
  return /^[+-]?\d+$/.test(trimmed) ? BigInt(trimmed) : null;
}

/**
 * round(numerator / denominator * 100) in TENTHS of a percent (so 20.0% is 200n),
 * rounding half away from zero. Explicit integer rounding: the same inputs give
 * the same digits on every platform. `denominator` must be positive.
 */
export function tenthsOfPercent(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) throw new RangeError("tenthsOfPercent: denominator must be positive");
  const scaled = numerator * 1000n;
  const negative = scaled < 0n;
  const magnitude = negative ? -scaled : scaled;
  const rounded = (magnitude * 2n + denominator) / (denominator * 2n);
  return negative ? -rounded : rounded;
}

/** 200n -> "20.0", -35n -> "3.5" (sign dropped: callers show direction with an arrow). */
export function formatTenths(tenths: bigint): string {
  const magnitude = tenths < 0n ? -tenths : tenths;
  return `${magnitude / 10n}.${magnitude % 10n}`;
}
