/**
 * Limitations domain logic — pure functions for statutory deadline computation,
 * notification scheduling, and expiry checks.
 *
 * Requirements: 10.5
 * Property 16: Limitation Clock Notification Scheduling
 */

export class LimitationDomainError extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = "LimitationDomainError";
  }
}

/**
 * Computes the statutory deadline by adding `periodDays` to `startDate`.
 *
 * @param startDate — the date from which the limitation period begins
 * @param periodDays — number of calendar days for the limitation period (must be > 0)
 * @returns the deadline Date (start + periodDays calendar days)
 */
export function computeDeadline(startDate: Date, periodDays: number): Date {
  if (periodDays <= 0) {
    throw new LimitationDomainError(
      "INVALID_PERIOD",
      `Limitation period must be positive, got ${periodDays}`,
    );
  }
  const deadline = new Date(startDate.getTime());
  deadline.setUTCDate(deadline.getUTCDate() + periodDays);
  return deadline;
}

/**
 * Computes notification dates at 30, 15, and 7 calendar days before the deadline.
 * Dates that are already past (relative to `currentDate`) are omitted.
 *
 * @param deadline — the statutory deadline
 * @param currentDate — the reference "now" for determining which notifications are still schedulable
 * @returns object with optional `at30d`, `at15d`, `at7d` dates (only future dates included)
 */
export function scheduleNotifications(
  deadline: Date,
  currentDate: Date,
): { at30d?: Date; at15d?: Date; at7d?: Date } {
  const result: { at30d?: Date; at15d?: Date; at7d?: Date } = {};

  const at30d = subtractDays(deadline, 30);
  const at15d = subtractDays(deadline, 15);
  const at7d = subtractDays(deadline, 7);

  if (at30d.getTime() > currentDate.getTime()) {
    result.at30d = at30d;
  }
  if (at15d.getTime() > currentDate.getTime()) {
    result.at15d = at15d;
  }
  if (at7d.getTime() > currentDate.getTime()) {
    result.at7d = at7d;
  }

  return result;
}

/**
 * Checks whether the given deadline has been exceeded relative to `currentDate`.
 *
 * @param deadline — the statutory deadline
 * @param currentDate — the reference "now"
 * @returns true if currentDate is at or past the deadline
 */
export function isExpired(deadline: Date, currentDate: Date): boolean {
  return currentDate.getTime() >= deadline.getTime();
}

/** Subtract `days` calendar days from a date, returning a new Date. */
function subtractDays(date: Date, days: number): Date {
  const result = new Date(date.getTime());
  result.setUTCDate(result.getUTCDate() - days);
  return result;
}
