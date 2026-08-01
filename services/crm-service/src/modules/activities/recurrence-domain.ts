/**
 * Pure recurrence + escalation maths for recurring tasks (AC-005).
 *
 * All arithmetic is done in UTC via Date.UTC / getUTC* so the result is
 * DST-agnostic: a "daily" task is always exactly 24h later regardless of local
 * clock changes, which is what a scheduler running in a container needs.
 */

export const CADENCES = ["daily", "weekly", "monthly", "quarterly"] as const;

export type Cadence = (typeof CADENCES)[number];

export function isCadence(value: string): value is Cadence {
  return (CADENCES as readonly string[]).includes(value);
}

const MONTHS_PER_STEP: Readonly<Record<"monthly" | "quarterly", number>> = {
  monthly: 1,
  quarterly: 3,
};

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

/** Days in a given UTC month (month is 0-based). */
function daysInUtcMonth(year: number, month: number): number {
  // Day 0 of the next month is the last day of this month.
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

/**
 * Adds whole months in UTC, clamping the day-of-month to the target month's
 * length. Jan 31 + 1 month = Feb 28 (Feb 29 in a leap year) rather than
 * rolling over into March, which is what users mean by "monthly on the last
 * day I picked".
 */
function addUtcMonths(from: Date, months: number): Date {
  const year = from.getUTCFullYear();
  const month = from.getUTCMonth();
  const day = from.getUTCDate();

  const totalMonths = month + months;
  const targetYear = year + Math.floor(totalMonths / 12);
  const targetMonth = ((totalMonths % 12) + 12) % 12;
  const clampedDay = Math.min(day, daysInUtcMonth(targetYear, targetMonth));

  return new Date(Date.UTC(
    targetYear,
    targetMonth,
    clampedDay,
    from.getUTCHours(),
    from.getUTCMinutes(),
    from.getUTCSeconds(),
    from.getUTCMilliseconds(),
  ));
}

/**
 * Next scheduled run after `from` for the given cadence.
 * @throws RangeError when `from` is not a valid date.
 */
export function nextOccurrence(cadence: Cadence, from: Date | string): Date {
  const base = from instanceof Date ? from : new Date(from);
  if (Number.isNaN(base.getTime())) {
    throw new RangeError("nextOccurrence: `from` is not a valid date");
  }

  switch (cadence) {
    case "daily":
      return new Date(base.getTime() + DAY_MS);
    case "weekly":
      return new Date(base.getTime() + 7 * DAY_MS);
    case "monthly":
      return addUtcMonths(base, MONTHS_PER_STEP.monthly);
    case "quarterly":
      return addUtcMonths(base, MONTHS_PER_STEP.quarterly);
  }
}

/**
 * True when an item that fell due at `dueAt` has been outstanding longer than
 * its escalation window. `null`/non-positive window = escalation disabled.
 */
export function shouldEscalate(
  dueAt: Date | string,
  escalateAfterHours: number | null | undefined,
  now: Date,
): boolean {
  if (escalateAfterHours === null || escalateAfterHours === undefined) return false;
  if (!Number.isFinite(escalateAfterHours) || escalateAfterHours <= 0) return false;

  const due = dueAt instanceof Date ? dueAt : new Date(dueAt);
  if (Number.isNaN(due.getTime())) return false;

  return now.getTime() >= due.getTime() + escalateAfterHours * HOUR_MS;
}
