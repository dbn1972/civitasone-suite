/**
 * Asia/Kolkata (IST) calendar helpers for date-only business rules.
 *
 * India has a single fixed offset (UTC+05:30, no DST), so the IST calendar date
 * of an instant is exactly `instant + 330 minutes` read back as UTC. Server-side
 * "today" comparisons (onboarding overdue, probation, contract expiry) previously
 * used `new Date().toISOString().slice(0, 10)` -- the UTC date -- which is still
 * "yesterday" between 00:00 and 05:30 IST, so the server and the web (which uses
 * lib/formatters todayIST) disagreed on what "today" was for five and a half
 * hours of every day. Every date-only rule that must agree with what an Indian
 * officer sees on the calendar should use these helpers instead.
 *
 * `now` is injectable so callers (and tests) never depend on the wall clock.
 */
const IST_OFFSET_MS = 330 * 60_000;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** The IST calendar date ("YYYY-MM-DD") of the given instant (default: now). */
export function todayIST(now: Date = new Date()): string {
  return new Date(now.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

function parseDateOnly(iso: string): Date | null {
  if (!DATE_ONLY.test(iso)) return null;
  const d = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** `iso` ("YYYY-MM-DD") plus `days` calendar days; null when `iso` is not a valid date-only string. */
export function addDaysToDateOnly(iso: string, days: number): string | null {
  const d = parseDateOnly(iso);
  if (!d) return null;
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * `iso` ("YYYY-MM-DD") plus `months` calendar months, keeping the day-of-month
 * and CLAMPING to the last day of a shorter target month (31 Jan + 1 month is
 * 28/29 Feb, not 3 Mar -- the overflow `Date#setUTCMonth` would otherwise give).
 * Null when `iso` is not a valid date-only string.
 */
export function addMonthsToDateOnly(iso: string, months: number): string | null {
  const d = parseDateOnly(iso);
  if (!d) return null;
  const day = d.getUTCDate();
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return target.toISOString().slice(0, 10);
}
