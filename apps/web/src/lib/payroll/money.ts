import { formatMoney } from "@/lib/formatters";

/**
 * Exact paise arithmetic for payroll report pages (GAP-PAYROLL-REGISTER-01,
 * GAP-PAYROLL-COMPARISON-04). payroll-service returns BIGINT money columns as
 * integer strings; summing them with `Number()` loses precision above 2^53
 * paise. These helpers stay in bigint the whole way and only convert for
 * display via formatMoney.
 */

/** Parse a minor-units value (bigint / safe integer / integer string). Null if not an exact integer. */
export function toMinorBigInt(value: unknown): bigint | null {
  if (typeof value === "bigint") return value;
  if (typeof value === "number") return Number.isSafeInteger(value) ? BigInt(value) : null;
  if (typeof value === "string" && /^[+-]?\d+$/.test(value.trim())) return BigInt(value.trim());
  return null;
}

/**
 * Sum minor-units values exactly. Returns null when any value is missing or
 * not an exact integer, so the caller shows "—" instead of a silently
 * partial total.
 */
export function sumMinor(values: readonly unknown[]): bigint | null {
  let total = 0n;
  for (const v of values) {
    const n = toMinorBigInt(v);
    if (n === null) return null;
    total += n;
  }
  return total;
}

/** U+2212 MINUS SIGN: a real typographic minus for display (never in CSV/export values). */
export const MINUS_SIGN = "−";

/**
 * Signed money for a delta: "+₹150.00", "−₹150.00", "₹0.00"; "—" when unknown.
 */
export function formatSignedMoney(minor: bigint | null): string {
  if (minor === null) return "—";
  if (minor === 0n) return formatMoney(0n);
  const abs = minor < 0n ? -minor : minor;
  return `${minor < 0n ? MINUS_SIGN : "+"}${formatMoney(abs)}`;
}

/**
 * Percentage change from `base` to `next`, or null when there is no
 * meaningful base (zero or unknown) -- callers render "—" for null.
 */
export function percentChange(base: bigint | null, next: bigint | null): number | null {
  if (base === null || next === null || base === 0n) return null;
  return (Number(next - base) / Number(base)) * 100;
}

/** "+12.5%" / "−3.0%" / "0.0%"; "—" when null. */
export function formatSignedPercent(pct: number | null): string {
  if (pct === null || !Number.isFinite(pct)) return "—";
  const rounded = Math.round(pct * 10) / 10;
  if (rounded === 0) return "0.0%";
  return `${rounded < 0 ? MINUS_SIGN : "+"}${Math.abs(rounded).toFixed(1)}%`;
}
