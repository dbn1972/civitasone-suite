/**
 * GAP-HR-WFH-01: the DoPT OM 2022 "at most 2 WFH days per ISO week" cap,
 * counted in DAYS, not in request rows.
 *
 * The first cut counted existing request ROWS whose fromDate fell in the week
 * (`rows.length >= 2`) and ignored the new request's own span, so a single
 * Monday-to-Friday request passed (it is one row, and the week had none), and
 * so did a Monday-to-Tuesday request on top of an existing Wednesday one. A
 * "day" here is a calendar day inside a pending/approved request's inclusive
 * [fromDate, toDate] range; days are de-duplicated, so two requests that
 * overlap on the same day use that day once.
 *
 * Calendar days (weekends and holidays included) are counted on purpose: it is
 * the only reading that never loosens the cap on a tenant with a 6-day week.
 * Whether weekly-offs / gazetted holidays should be excluded from the count is
 * an owner decision recorded on the ledger item, not guessed here.
 *
 * Week boundaries are Monday-Sunday in UTC -- the same coarse boundary
 * routes.ts already used (a validation guard, not a display date).
 *
 * Kept free of DB / policy imports so it is unit-testable on its own.
 */

/** DoPT OM 2022: maximum WFH days per ISO week for eligible staff. */
export const WFH_WEEKLY_DAY_CAP = 2;

export interface WfhDateRange {
  /** Inclusive, "YYYY-MM-DD". */
  fromDate: string;
  /** Inclusive, "YYYY-MM-DD". */
  toDate: string;
}

export interface WfhWeekOverflow {
  /** Monday ("YYYY-MM-DD") of the offending ISO week. */
  weekStart: string;
  /** Distinct WFH days the week would hold if the request were accepted. */
  days: number;
}

const DAY_MS = 86_400_000;

/** True for a real calendar date ("2026-02-30" and "2026-13-01" are not). */
export function isValidIsoDate(value: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

/** Whole days since 1970-01-01 (UTC) for a validated "YYYY-MM-DD". */
function dayNumber(dateStr: string): number {
  return Math.floor(Date.parse(`${dateStr}T00:00:00.000Z`) / DAY_MS);
}

function dayNumberToDate(day: number): string {
  return new Date(day * DAY_MS).toISOString().slice(0, 10);
}

/** Epoch-day of the Monday on or before `day` (1970-01-01 was a Thursday). */
function mondayOf(day: number): number {
  const sinceMonday = (((day + 3) % 7) + 7) % 7;
  return day - sinceMonday;
}

/** Monday and Sunday ("YYYY-MM-DD") of the ISO week containing `dateStr`. */
export function isoWeekBounds(dateStr: string): { start: string; end: string } {
  const monday = mondayOf(dayNumber(dateStr));
  return { start: dayNumberToDate(monday), end: dayNumberToDate(monday + 6) };
}

/** Adds the days of `range` that fall inside the week starting at `weekStart` to `into`. */
function addRangeDaysInWeek(into: Set<number>, range: WfhDateRange, weekStart: number): void {
  const from = Math.max(dayNumber(range.fromDate), weekStart);
  const to = Math.min(dayNumber(range.toDate), weekStart + 6);
  for (let d = from; d <= to; d++) into.add(d);
}

/**
 * Distinct WFH days `ranges` occupy in the ISO week containing `dateInWeek`
 * (used for the "this week" figure the request form shows).
 */
export function wfhDaysUsedInWeek(ranges: WfhDateRange[], dateInWeek: string): number {
  const weekStart = mondayOf(dayNumber(dateInWeek));
  const used = new Set<number>();
  for (const r of ranges) addRangeDaysInWeek(used, r, weekStart);
  return used.size;
}

/**
 * The first ISO week the `requested` range touches in which the request plus
 * `existing` (the employee's pending/approved ranges) would hold more than
 * `cap` distinct days, or null when every touched week stays within the cap.
 * Both dates of every range must already be validated (isValidIsoDate) and
 * from <= to.
 *
 * Terminates quickly for any input: the loop returns at the first week with
 * more than `cap` days, and a range covering a full week has seven.
 */
export function findWfhWeeklyOverflow(
  requested: WfhDateRange,
  existing: WfhDateRange[],
  cap: number = WFH_WEEKLY_DAY_CAP,
): WfhWeekOverflow | null {
  const last = dayNumber(requested.toDate);
  for (let week = mondayOf(dayNumber(requested.fromDate)); week <= last; week += 7) {
    const used = new Set<number>();
    addRangeDaysInWeek(used, requested, week);
    for (const r of existing) addRangeDaysInWeek(used, r, week);
    if (used.size > cap) return { weekStart: dayNumberToDate(week), days: used.size };
  }
  return null;
}
