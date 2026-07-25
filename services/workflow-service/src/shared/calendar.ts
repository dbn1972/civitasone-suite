/**
 * CAP-027 — Working-calendar SLA arithmetic (pure domain).
 *
 * Due dates for a step are computed by consuming only WORKING minutes: minutes
 * that fall on a working weekday (not a holiday) within the daily work window
 * [workStartMinute, workEndMinute). Off-hours, weekends and holidays are skipped
 * — so a 4-hour SLA started at 16:00 with a 09:00–17:00 window lands at 11:00
 * the next working day, not 20:00 the same evening.
 *
 * Times are computed in UTC minute-of-day; a `timezone` field is carried for
 * display/config but the arithmetic is UTC-based (callers normalise inputs to
 * the tenant's civil offset upstream). All functions are pure and clock-free.
 */

export interface WorkingCalendar {
  timezone: string;
  /** Working weekdays, 0=Sunday … 6=Saturday. */
  workweek: number[];
  /** Holiday dates as YYYY-MM-DD (UTC). */
  holidays: string[];
  /** Start of the daily work window, minutes from midnight UTC (e.g. 540=09:00). */
  workStartMinute: number;
  /** End of the daily work window, minutes from midnight UTC (e.g. 1020=17:00). */
  workEndMinute: number;
}

const DAY_MS = 86_400_000;
const MIN_MS = 60_000;
/** Hard cap so an empty/degenerate calendar can never spin forever. */
const MAX_DAYS = 3660;

function ymdUTC(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function startOfUTCDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/** True when `date` falls on a working weekday that is not a holiday. */
export function isWorkingDay(cal: WorkingCalendar, date: Date): boolean {
  if (!cal.workweek.includes(date.getUTCDay())) return false;
  return !cal.holidays.includes(ymdUTC(date));
}

function validWindow(cal: WorkingCalendar): boolean {
  return (
    cal.workweek.length > 0 &&
    cal.workEndMinute > cal.workStartMinute &&
    cal.workStartMinute >= 0 &&
    cal.workEndMinute <= 1440
  );
}

/**
 * Absolute due timestamp after consuming `slaMinutes` working minutes from
 * `from`. Returns null when slaMinutes<=0 or the calendar defines no reachable
 * working time (degenerate config) — the caller then falls back to no SLA.
 */
export function computeDueOnCalendar(
  cal: WorkingCalendar,
  from: Date,
  slaMinutes: number | null | undefined,
): Date | null {
  if (slaMinutes === null || slaMinutes === undefined || slaMinutes <= 0) return null;
  if (!validWindow(cal)) return null;

  let remaining = slaMinutes;
  let cursor = from;

  for (let i = 0; i < MAX_DAYS && remaining > 0; i++) {
    const dayStart = startOfUTCDay(cursor);
    if (!isWorkingDay(cal, dayStart)) {
      cursor = new Date(dayStart.getTime() + DAY_MS);
      continue;
    }
    const winStart = new Date(dayStart.getTime() + cal.workStartMinute * MIN_MS);
    const winEnd = new Date(dayStart.getTime() + cal.workEndMinute * MIN_MS);
    if (cursor >= winEnd) {
      cursor = new Date(dayStart.getTime() + DAY_MS);
      continue;
    }
    const effStart = cursor < winStart ? winStart : cursor;
    const availMin = (winEnd.getTime() - effStart.getTime()) / MIN_MS;
    if (remaining <= availMin) {
      return new Date(effStart.getTime() + remaining * MIN_MS);
    }
    remaining -= availMin;
    cursor = new Date(dayStart.getTime() + DAY_MS);
  }
  return null; // unreachable within the guard horizon
}

/**
 * Count WORKING minutes elapsed in [from, to]. Used for ageing (how long a task
 * has actually consumed against its SLA, excluding nights/weekends/holidays).
 */
export function workingMinutesBetween(cal: WorkingCalendar, from: Date, to: Date): number {
  if (to <= from || !validWindow(cal)) return 0;
  let total = 0;
  let cursor = from;
  for (let i = 0; i < MAX_DAYS && cursor < to; i++) {
    const dayStart = startOfUTCDay(cursor);
    if (!isWorkingDay(cal, dayStart)) {
      cursor = new Date(dayStart.getTime() + DAY_MS);
      continue;
    }
    const winStart = new Date(dayStart.getTime() + cal.workStartMinute * MIN_MS);
    const winEnd = new Date(dayStart.getTime() + cal.workEndMinute * MIN_MS);
    const segStart = cursor > winStart ? cursor : winStart;
    const segEnd = to < winEnd ? to : winEnd;
    if (segEnd > segStart) total += (segEnd.getTime() - segStart.getTime()) / MIN_MS;
    cursor = new Date(dayStart.getTime() + DAY_MS);
  }
  return Math.round(total);
}

/**
 * Ageing in working minutes minus any paused minutes (SLA-clock pauses), never
 * negative. `pausedMinutes` is the total the task spent in a paused state.
 */
export function agingMinutes(
  cal: WorkingCalendar,
  from: Date,
  to: Date,
  pausedMinutes = 0,
): number {
  return Math.max(0, workingMinutesBetween(cal, from, to) - Math.max(0, pausedMinutes));
}

/**
 * A 24x7 fallback calendar (every day, full day) — used when no working
 * calendar is configured so behaviour degrades to plain wall-clock SLA.
 */
export const ALWAYS_ON: WorkingCalendar = {
  timezone: "UTC",
  workweek: [0, 1, 2, 3, 4, 5, 6],
  holidays: [],
  workStartMinute: 0,
  workEndMinute: 1440,
};
