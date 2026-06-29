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
 * Zod field for money minor units in COMMAND/EVENT payloads. Accepts a JSON
 * number (safe integer) or a decimal string, and normalises to a canonical
 * base-10 STRING so the value crosses the boundary without precision loss.
 * Use this in payload validators; rebuild a bigint with `parseMinor` on read.
 */
export const zMoneyMinorString = z
  .union([z.string().regex(DIGITS_RE, "must be a base-10 integer"), z.number().int()])
  .transform((v) => minorString(v));

/** Like `zMoneyMinorString` but rejects negative amounts (the common case). */
export const zMoneyMinorStringNonNeg = z
  .union([z.string().regex(/^\d+$/, "must be a non-negative base-10 integer"), z.number().int().nonnegative()])
  .transform((v) => minorString(v));

/** Zod field that decodes money minor units straight to a bigint. */
export const zMoneyMinor = z
  .union([z.string().regex(DIGITS_RE), z.number().int(), z.bigint()])
  .transform((v) => parseMinor(v));
