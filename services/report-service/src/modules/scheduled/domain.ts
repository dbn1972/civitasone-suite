/**
 * scheduled/domain.ts — Pure domain logic for scheduled report generation.
 *
 * Computes the next run time based on cadence. All logic is pure (no I/O).
 */
import type { ScheduledReportCadence } from "./schema.js";

/**
 * Cadence interval durations in milliseconds.
 * monthly uses a calendar-aware computation instead of fixed ms.
 */
const CADENCE_MS: Record<Exclude<ScheduledReportCadence, "monthly">, number> = {
  hourly: 60 * 60_000,
  daily: 24 * 60 * 60_000,
  weekly: 7 * 24 * 60 * 60_000,
};

/**
 * Compute the next run timestamp based on the cadence and the reference time.
 *
 * For hourly/daily/weekly: adds a fixed interval.
 * For monthly: advances to the same day-of-month in the next calendar month,
 * clamping to the last day of that month if needed.
 */
export function computeNextRunAt(fromDate: Date, cadence: ScheduledReportCadence): Date {
  if (cadence === "monthly") {
    return computeNextMonthly(fromDate);
  }
  const intervalMs = CADENCE_MS[cadence];
  return new Date(fromDate.getTime() + intervalMs);
}

/**
 * Advance to the same day-of-month in the next calendar month.
 * If the target month has fewer days, clamp to the last day.
 */
function computeNextMonthly(from: Date): Date {
  const year = from.getUTCFullYear();
  const month = from.getUTCMonth();
  const day = from.getUTCDate();
  const hours = from.getUTCHours();
  const minutes = from.getUTCMinutes();
  const seconds = from.getUTCSeconds();
  const ms = from.getUTCMilliseconds();

  let nextMonth = month + 1;
  let nextYear = year;
  if (nextMonth > 11) {
    nextMonth = 0;
    nextYear++;
  }

  const lastDayOfNextMonth = new Date(Date.UTC(nextYear, nextMonth + 1, 0)).getUTCDate();
  const clampedDay = Math.min(day, lastDayOfNextMonth);

  return new Date(Date.UTC(nextYear, nextMonth, clampedDay, hours, minutes, seconds, ms));
}

/**
 * Validate that a cadence string is a recognized value.
 */
export function isValidCadence(cadence: string): cadence is ScheduledReportCadence {
  return cadence === "hourly" || cadence === "daily" || cadence === "weekly" || cadence === "monthly";
}

/** Maximum number of recipients per scheduled report. */
export const MAX_RECIPIENTS = 20;

/** Report generation timeout in milliseconds. */
export const GENERATION_TIMEOUT_MS = 120_000;

/** Maximum delivery retries before marking failed. */
export const MAX_DELIVERY_RETRIES = 3;
