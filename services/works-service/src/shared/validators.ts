import { z } from "zod";
import { zMoneyMinorStringNonNeg } from "@civitasone/schemas";

/**
 * Shared request-field validators for works-service routes.
 *
 * Why these exist (W2 works rescan, cluster 01): three route families accepted a date as a bare `z.string()` and a
 * money field as any integer (zero and negative included). A bad date was accepted with 202 and then threw inside
 * the async consumer (`new Date(x)` is an Invalid Date, the insert fails, the clerk is never told); a zero or
 * negative amount was accepted and persisted as public money. Rejecting both at the boundary turns them into an
 * immediate 400 with a field error.
 */

/** Largest value a Postgres bigint (int8) money column can hold, in minor units (paise). */
export const MAX_MINOR = 9223372036854775807n;

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
const isoDateTime = z.string().datetime({ offset: true });

/**
 * A real calendar date. Accepts a bare `YYYY-MM-DD` (what an `<input type="date">` submits, checked to be a date that
 * exists, so 2026-02-30 is rejected) or a full ISO-8601 date-time with `Z` or an offset (what API clients send).
 */
export function isValidCalendarDate(value: string): boolean {
  const m = DATE_ONLY.exec(value);
  if (m) {
    const year = Number(m[1]);
    const month = Number(m[2]);
    const day = Number(m[3]);
    const d = new Date(Date.UTC(year, month - 1, day));
    return d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day;
  }
  return isoDateTime.safeParse(value).success;
}

export const zCalendarDate = z
  .string()
  .refine(isValidCalendarDate, { message: "must be a valid date (YYYY-MM-DD or an ISO-8601 date-time)" });

/**
 * Money in integer minor units that must be strictly greater than zero (an approved / sanctioned / gross amount).
 * Negative values are rejected by the non-negative base schema; zero and a value beyond the int8 column are rejected
 * here. Output is the canonical base-10 string, like zMoneyMinorString.
 */
export const zPositiveMoneyMinor = zMoneyMinorStringNonNeg.refine(
  // When the base schema's transform already reported an issue (an unsafe JS number) the value is z.NEVER, not a
  // string: let that original issue stand rather than throwing from BigInt().
  (v) => typeof v !== "string" || (BigInt(v) > 0n && BigInt(v) <= MAX_MINOR),
  { message: "must be greater than zero" },
);

/** Money in minor units that may be zero but never negative (a deduction: none is a valid answer). */
export const zNonNegMoneyMinor = zMoneyMinorStringNonNeg.refine((v) => typeof v !== "string" || BigInt(v) <= MAX_MINOR, {
  message: "is larger than the maximum storable amount",
});
