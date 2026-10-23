import { z } from "zod";

/**
 * Money codec (R7) — money is stored and transported as integer MINOR units
 * (paise) and MUST NOT pass through a JS `number` at any service boundary:
 * `Number(bigintPaise)` silently loses precision above 2^53 (~₹9,007 cr), and
 * `z.number()` on a JSON payload caps the same way.
 *
 * Strategy:
 *  - DECODE is tolerant: `parseMinor` accepts string | number | bigint so a
 *    consumer can read both legacy numeric payloads and new string payloads —
 *    converting producers to emit strings never breaks an existing consumer.
 *  - ENCODE is exact: `minorString` always serialises to a base-10 string, so
 *    producers carry paise across the queue/HTTP boundary without precision loss.
 *
 * A `number` input is only accepted when it is a SAFE integer; a larger number
 * is rejected (it has already lost precision and cannot be trusted).
 */

const DIGITS_RE = /^-?\d+$/;

/** Decode money minor units from string | number | bigint into an exact bigint. */
export function parseMinor(value: string | number | bigint): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number") {
    if (!Number.isInteger(value)) {
      throw new RangeError(`money minor must be an integer, got ${value}`);
    }
    if (!Number.isSafeInteger(value)) {
      throw new RangeError(
        `money minor ${value} exceeds the safe-integer range; transport it as a string`,
      );
    }
    return BigInt(value);
  }
  const s = value.trim();
  if (!DIGITS_RE.test(s)) {
    throw new RangeError(`money minor string must be a base-10 integer, got '${value}'`);
  }
  return BigInt(s);
}

/** Encode money minor units to an exact base-10 string for transport. */
export function minorString(value: bigint | number | string): string {
  return parseMinor(value).toString();
}

/**
 * BUG FIX: `parseMinor`/`minorString` `throw` a raw `RangeError` for an
 * unsafe-integer plain number. Inside a Zod `.transform()`, an uncaught throw
 * escapes `.parse()`/`.safeParse()` entirely instead of becoming a normal
 * ZodError — every route using these schemas turned an out-of-range amount
 * into an unhandled-exception 500 instead of a clean 400. These two wrappers
 * catch that throw and report it as a proper Zod issue via `ctx.addIssue`,
 * returning `z.NEVER` so `.parse()` fails the normal, catchable way.
 */
function toMinorStringIssue(value: string | number, ctx: z.RefinementCtx): string {
  try {
    return minorString(value);
  } catch (err) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: err instanceof Error ? err.message : "invalid money minor value",
    });
    return z.NEVER;
  }
}

function toMinorBigintIssue(value: string | number | bigint, ctx: z.RefinementCtx): bigint {
  try {
    return parseMinor(value);
  } catch (err) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: err instanceof Error ? err.message : "invalid money minor value",
    });
    return z.NEVER;
  }
}

/**
 * Zod field for money minor units in COMMAND/EVENT payloads. Accepts a JSON
 * number (safe integer) or a decimal string, and normalises to a canonical
 * base-10 STRING so the value crosses the boundary without precision loss.
 * Use this in payload validators; rebuild a bigint with `parseMinor` on read.
 */
export const zMoneyMinorString = z
  .union([z.string().regex(DIGITS_RE, "must be a base-10 integer"), z.number().int()])
  .transform(toMinorStringIssue);

/** Like `zMoneyMinorString` but rejects negative amounts (the common case). */
export const zMoneyMinorStringNonNeg = z
  .union([z.string().regex(/^\d+$/, "must be a non-negative base-10 integer"), z.number().int().nonnegative()])
  .transform(toMinorStringIssue);

/**
 * STRICT read-model codec: money minor units (paise) as a base-10 integer
 * STRING only (signed; a net balance can be negative). Unlike
 * `zMoneyMinorString` it rejects a JSON number outright. Use it where a number
 * on the wire could be a different unit, e.g. a stale client or server still
 * sending rupee floats, which a tolerant codec would silently read as paise and
 * mis-scale by 100x. A `1e3`, `12.5`, `""`, `abc` or `1,000` is a schema error,
 * never a coerced amount (GAP-FINANCE-ACCOUNTING-FINANCIAL-STATEMENTS-03).
 */
export const zMoneyMinorStrict = z
  .string()
  .regex(DIGITS_RE, "must be a base-10 integer string of minor units (paise)");

/** Zod field that decodes money minor units straight to a bigint. */
export const zMoneyMinor = z
  .union([z.string().regex(DIGITS_RE), z.number().int(), z.bigint()])
  .transform(toMinorBigintIssue);

const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);

/**
 * STRICT bigint-to-number bridge for the few places a JSON `number` or float
 * engine input is mandated (a legacy numeric response contract, an
 * IEEE-754 pro-rata/percentage calculation). Parses with `parseMinor` (so a
 * non-integer / malformed value is rejected) and then REFUSES any value outside
 * the safe-integer range instead of silently rounding it the way
 * `Number(bigint)` does. The result is therefore always exactly the stored
 * amount, or a RangeError the caller can surface.
 */
export function minorToSafeNumber(value: string | number | bigint): number {
  const exact = parseMinor(value);
  if (exact > MAX_SAFE || exact < -MAX_SAFE) {
    throw new RangeError(
      `money minor ${exact.toString()} exceeds the safe-integer range; keep it as a bigint/string`,
    );
  }
  return Number(exact);
}

/**
 * Exact major-unit decimal string for money minor units, e.g. 123450n -> "1234.50"
 * (default 2 decimals). Pure bigint arithmetic, no float, any magnitude.
 */
export function minorToMajorString(value: string | number | bigint, decimals = 2): string {
  const exact = parseMinor(value);
  const negative = exact < 0n;
  const abs = negative ? -exact : exact;
  const scale = 10n ** BigInt(decimals);
  const whole = (abs / scale).toString();
  if (decimals === 0) return `${negative ? "-" : ""}${whole}`;
  const frac = (abs % scale).toString().padStart(decimals, "0");
  return `${negative ? "-" : ""}${whole}.${frac}`;
}

/**
 * Major-unit amount as a JS number, for display text and for wire formats that
 * mandate a decimal number (e.g. NIC e-invoice / e-way-bill rupee fields). It
 * parses the exact decimal string, so the result is the nearest double to the
 * true amount; never feed it back into stored or summed money.
 */
export function minorToMajorNumber(value: string | number | bigint, decimals = 2): number {
  return parseFloat(minorToMajorString(value, decimals));
}
