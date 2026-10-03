/**
 * GAP-ADMIN-ORG-03: when is an org unit inactive?
 *
 * A unit is inactive only once its end date has been reached, comparing calendar
 * dates in IST: `effective_to (IST date) <= today (IST date)`. A unit end-dated to
 * a FUTURE day is still in force. The web client applies the same rule
 * (apps/web .../admin/org/orgUnitState.ts); the SQL form below must stay equivalent.
 */
const IST = "Asia/Kolkata";

/** YYYY-MM-DD of `d` on the IST calendar. */
export function istDate(d: Date): string {
  return d.toLocaleDateString("en-CA", { timeZone: IST });
}

export function isUnitInactive(u: { effectiveTo: Date | null }, now: Date = new Date()): boolean {
  return u.effectiveTo !== null && istDate(u.effectiveTo) <= istDate(now);
}

/** SQL predicate text equivalent to !isUnitInactive for a table alias `a` (column effective_to). */
export const IN_FORCE_SQL = (a: string): string =>
  `(${a}.effective_to IS NULL OR (${a}.effective_to AT TIME ZONE 'Asia/Kolkata')::date > (now() AT TIME ZONE 'Asia/Kolkata')::date)`;
