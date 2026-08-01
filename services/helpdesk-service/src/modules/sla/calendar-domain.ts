/**
 * Business Calendar domain logic — deadline computation respecting work hours.
 *
 * computeDeadline: given a start time, minutes to add, and a calendar,
 * advances only during business hours (skipping non-work-days and holidays).
 */
import type { WorkDay, Holiday, BusinessCalendarRow } from "./calendar-schema.js";

/**
 * Compute an SLA deadline that only counts business hours.
 *
 * Algorithm:
 * 1. Start from the given startTime
 * 2. For each minute, check if that minute falls within a work day/hour
 * 3. Only count minutes that fall within work hours
 * 4. Skip holidays entirely
 *
 * For performance, we advance day-by-day rather than minute-by-minute.
 *
 * @param startTime - when the clock starts (UTC)
 * @param minutes - total business minutes to add
 * @param calendar - business calendar defining work hours
 * @returns the computed deadline (UTC)
 */
export function computeDeadline(
  startTime: Date,
  minutes: number,
  calendar: Pick<BusinessCalendarRow, "workDays" | "holidays" | "timezone">,
): Date {
  if (minutes <= 0) return startTime;

  const workDays = calendar.workDays as WorkDay[];
  const holidays = (calendar.holidays as Holiday[] | null) ?? [];
  const holidaySet = new Set(holidays.map((h) => h.date));

  let remainingMinutes = minutes;
  let current = new Date(startTime.getTime());

  // Safety limit: prevent infinite loops (max 365 days of advancement)
  const maxIterations = 365;
  let iterations = 0;

  while (remainingMinutes > 0 && iterations < maxIterations) {
    iterations++;

    const dateStr = formatDateStr(current);

    // Skip holidays
    if (holidaySet.has(dateStr)) {
      current = nextDay(current);
      continue;
    }

    // Get work schedule for this day of week
    const dayOfWeek = current.getUTCDay();
    const schedule = workDays.find((wd) => wd.day === dayOfWeek);

    if (!schedule) {
      // Not a work day — advance to next day
      current = nextDay(current);
      continue;
    }

    const dayStart = parseTime(dateStr, schedule.start);
    const dayEnd = parseTime(dateStr, schedule.end);
    const workMinutesInDay = (dayEnd.getTime() - dayStart.getTime()) / 60_000;

    if (workMinutesInDay <= 0) {
      current = nextDay(current);
      continue;
    }

    // Determine effective start within this work day
    let effectiveStart: Date;
    if (current.getTime() < dayStart.getTime()) {
      effectiveStart = dayStart;
    } else if (current.getTime() >= dayEnd.getTime()) {
      // Past end of work day — advance to next day
      current = nextDay(current);
      continue;
    } else {
      effectiveStart = current;
    }

    const availableMinutes = (dayEnd.getTime() - effectiveStart.getTime()) / 60_000;

    if (remainingMinutes <= availableMinutes) {
      // Deadline falls within this day
      return new Date(effectiveStart.getTime() + remainingMinutes * 60_000);
    }

    // Consume all available minutes this day
    remainingMinutes -= availableMinutes;
    current = nextDay(current);
  }

  // Fallback: if we exhausted iterations, return the last computed time + remaining
  return new Date(current.getTime() + remainingMinutes * 60_000);
}

/**
 * Calculate elapsed business minutes between two timestamps.
 */
export function computeElapsedBusinessMinutes(
  start: Date,
  end: Date,
  calendar: Pick<BusinessCalendarRow, "workDays" | "holidays" | "timezone">,
): number {
  if (end.getTime() <= start.getTime()) return 0;

  const workDays = calendar.workDays as WorkDay[];
  const holidays = (calendar.holidays as Holiday[] | null) ?? [];
  const holidaySet = new Set(holidays.map((h) => h.date));

  let totalMinutes = 0;
  let current = new Date(start.getTime());
  const maxIterations = 365;
  let iterations = 0;

  while (current.getTime() < end.getTime() && iterations < maxIterations) {
    iterations++;

    const dateStr = formatDateStr(current);

    if (holidaySet.has(dateStr)) {
      current = nextDay(current);
      continue;
    }

    const dayOfWeek = current.getUTCDay();
    const schedule = workDays.find((wd) => wd.day === dayOfWeek);

    if (!schedule) {
      current = nextDay(current);
      continue;
    }

    const dayStart = parseTime(dateStr, schedule.start);
    const dayEnd = parseTime(dateStr, schedule.end);

    const effectiveStart = new Date(Math.max(current.getTime(), dayStart.getTime()));
    const effectiveEnd = new Date(Math.min(end.getTime(), dayEnd.getTime()));

    if (effectiveStart.getTime() < effectiveEnd.getTime()) {
      totalMinutes += (effectiveEnd.getTime() - effectiveStart.getTime()) / 60_000;
    }

    current = nextDay(current);
  }

  return totalMinutes;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDateStr(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function parseTime(dateStr: string, time: string): Date {
  return new Date(`${dateStr}T${time}:00.000Z`);
}

function nextDay(date: Date): Date {
  const d = new Date(date.getTime());
  d.setUTCDate(d.getUTCDate() + 1);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}
