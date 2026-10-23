/**
 * Money helpers for payroll-service (R7: money is bigint MINOR units / paise).
 *
 * Rules these helpers enforce, so route/consumer code never applies a bare
 * numeric coercion to a paise value (scripts/ci/money-precision-guard.mjs flags
 * it, and above 2^53 paise it silently loses precision):
 *  - decode a DB / wire value with `minorFromDb` (strict /^-?\d+$/ for strings,
 *    safe integers for numbers) -- never a bare numeric coercion of the value;
 *  - do ALL arithmetic and rounding on bigint (`divRoundHalfUp`,
 *    `roundMinorToRupees`);
 *  - leave bigint exactly once, at the wire edge, via one of the range-checked
 *    converters below. They THROW instead of rounding when the value cannot be
 *    represented exactly, so a too-large amount fails loudly.
 */

const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);

/** Strict decimal-integer pattern for paise strings (optional leading minus for net/variance amounts). */
const SIGNED_DIGITS_RE = /^-?\d+$/;
/** Strict unsigned pattern, for amounts that can never be negative. */
const UNSIGNED_DIGITS_RE = /^\d+$/;

/**
 * Decode an integer paise value read from Postgres / JSON into an exact bigint.
 * Accepts bigint, a safe-integer number (legacy numeric JSON) or a strict
 * base-10 integer string. Anything else (float, '1e3', '', '12.5', NaN, unsafe
 * integer) is rejected rather than coerced.
 */
export function minorFromDb(value: unknown): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) throw new RangeError(`money minor must be a safe integer, got ${value}`);
    return BigInt(value);
  }
  if (typeof value === "string" && SIGNED_DIGITS_RE.test(value)) return BigInt(value);
  throw new RangeError(`money minor must be a base-10 integer string, got '${String(value)}'`);
}

/** Like minorFromDb but for non-negative amounts only (/^\d+$/); a null/undefined column reads as 0n. */
export function unsignedMinorFromDb(value: unknown): bigint {
  if (value === null || value === undefined) return 0n;
  const v = minorFromDb(value);
  if (typeof value === "string" && !UNSIGNED_DIGITS_RE.test(value)) {
    throw new RangeError(`money minor must be a non-negative base-10 integer string, got '${value}'`);
  }
  if (v < 0n) throw new RangeError(`money minor must be non-negative, got ${v}`);
  return v;
}

/**
 * Leave bigint for a JS number, only when the result is an exactly representable
 * integer. Use for values that are NOT paise-precision money (whole rupees,
 * counts, percentages) and as the single audited bigint-to-wire edge.
 */
export function toSafeInt(value: bigint): number {
  if (value > MAX_SAFE || value < -MAX_SAFE) {
    throw new RangeError("amount exceeds the exact-integer range of a JSON number");
  }
  return Number(value);
}

/** Paise as the JSON-number paise integer used on the existing wire contracts (range-checked, never rounds). */
export function minorToWireNumber(value: bigint): number {
  return toSafeInt(value);
}

/**
 * Legacy DISPLAY rupees (a float) from exact paise: the correctly-rounded double
 * of the exact decimal "1234.56" (parsed from the integer-built string, never
 * from a float division). Payloads that carry this float always carry the exact
 * paise as a string next to it, so this never throws -- for an absurd amount
 * (beyond 2^53 rupees) the float is merely the nearest double and the paise
 * string stays authoritative.
 */
export function minorToRupees(value: bigint): number {
  return Number.parseFloat(formatRupees(value));
}

/** Floor division for bigint (BigInt `/` truncates toward zero). */
function floorDiv(num: bigint, den: bigint): bigint {
  const q = num / den;
  return (num % den !== 0n) && ((num < 0n) !== (den < 0n)) ? q - 1n : q;
}

/** round(num / den) with ties toward +infinity -- the semantics of Math.round, in exact integer math. */
export function divRoundHalfUp(num: bigint, den: bigint): bigint {
  if (den <= 0n) throw new RangeError("divRoundHalfUp: denominator must be positive");
  return floorDiv(2n * num + den, 2n * den);
}

/** Whole rupees (bigint) from paise, rounded exactly like Math.round(paise / 100). */
export function roundMinorToRupees(value: bigint): bigint {
  return divRoundHalfUp(value, 100n);
}

/** Exact "1234.50" / "-0.05" rupee string from paise (no float, for bank files and CSV). */
export function formatRupees(value: bigint): string {
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const frac = (abs % 100n).toString().padStart(2, "0");
  return `${negative ? "-" : ""}${(abs / 100n).toString()}.${frac}`;
}

/** Exact en-IN grouped rupee string ("1,23,456.50") from paise. */
export function formatRupeesIN(value: bigint): string {
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const frac = (abs % 100n).toString().padStart(2, "0");
  return `${negative ? "-" : ""}${(abs / 100n).toLocaleString("en-IN")}.${frac}`;
}
