/**
 * exports/scheduled-domain.ts — Pure domain logic for scheduled exports.
 *
 * Computes the next run time based on cadence. All logic is pure (no I/O)
 * for testability.
 */
import type { ScheduledExportCadence } from "./scheduled-schema.js";

/**
 * Cadence interval durations in milliseconds.
 * monthly uses a calendar-aware computation instead of fixed ms.
 */
const CADENCE_MS: Record<Exclude<ScheduledExportCadence, "monthly">, number> = {
  hourly: 60 * 60_000,        // 1 hour
  daily: 24 * 60 * 60_000,    // 24 hours
  weekly: 7 * 24 * 60 * 60_000, // 7 days
};

/**
 * Compute the next run timestamp based on the cadence and the reference time
 * (typically the current run time or lastRunAt).
 *
 * For hourly/daily/weekly: adds a fixed interval.
 * For monthly: advances to the same day-of-month in the next calendar month,
 * clamping to the last day of that month if needed.
 */
export function computeNextRunAt(fromDate: Date, cadence: ScheduledExportCadence): Date {
  if (cadence === "monthly") {
    return computeNextMonthly(fromDate);
  }
  const intervalMs = CADENCE_MS[cadence];
  return new Date(fromDate.getTime() + intervalMs);
}

/**
 * Advance to the same day-of-month in the next calendar month.
 * If the target month has fewer days, clamp to the last day.
 * E.g., Jan 31 → Feb 28 (non-leap) or Feb 29 (leap year).
 */
function computeNextMonthly(from: Date): Date {
  const year = from.getUTCFullYear();
  const month = from.getUTCMonth(); // 0-indexed
  const day = from.getUTCDate();
  const hours = from.getUTCHours();
  const minutes = from.getUTCMinutes();
  const seconds = from.getUTCSeconds();
  const ms = from.getUTCMilliseconds();

  // Move to next month
  let nextMonth = month + 1;
  let nextYear = year;
  if (nextMonth > 11) {
    nextMonth = 0;
    nextYear++;
  }

  // Determine last day of the target month
  const lastDayOfNextMonth = new Date(Date.UTC(nextYear, nextMonth + 1, 0)).getUTCDate();
  const clampedDay = Math.min(day, lastDayOfNextMonth);

  return new Date(Date.UTC(nextYear, nextMonth, clampedDay, hours, minutes, seconds, ms));
}

/**
 * Validate that a cadence string is a recognized value.
 */
export function isValidCadence(cadence: string): cadence is ScheduledExportCadence {
  return cadence === "hourly" || cadence === "daily" || cadence === "weekly" || cadence === "monthly";
}
