/**
 * visitor-service: recurring-pass domain logic.
 *
 * Pure logic for Recurring_Pass lifecycle (Requirement 12 — Recurring and
 * Contractor Pass Management):
 *   - Max-90-day validity window enforcement (Requirement 12.2).
 *   - Permitted-days / time-window schedule check for check-in eligibility
 *     (Requirement 12.3, Property 20: Recurring Pass Schedule Enforcement).
 *   - Suspend / revoke / reactivate status state machine (Requirement 12.4).
 *   - Per-day attendance-log aggregation from check-in records
 *     (Requirement 12.6).
 *
 * No I/O happens in this module — callers (consumer.ts, routes.ts) perform
 * DB writes, Redis revocation-set updates, and outbox events.
 */

export class DomainError extends Error {
  constructor(public code: string, message: string) {
    super(`[${code}] ${message}`);
    this.name = "DomainError";
  }
}

// ── Validity Window Enforcement ───────────────────────────────────────────

const MAX_VALIDITY_MS = 90 * 24 * 60 * 60 * 1000; // Requirement 12.2: 90-day cap

/**
 * Validates a Recurring_Pass validity window (Requirement 12.2): `endDate`
 * must be after `startDate`, and the span must not exceed 90 days. Throws
 * DomainError on either violation — callers surface this as
 * `RECURRING_PASS_MAX_DURATION` (400) per design.md's error table.
 */
export function validateValidityWindow(startDate: Date, endDate: Date): void {
  if (endDate.getTime() <= startDate.getTime()) {
    throw new DomainError(
      "INVALID_WINDOW",
      "endDate must be after startDate",
    );
  }

  if (endDate.getTime() - startDate.getTime() > MAX_VALIDITY_MS) {
    throw new DomainError(
      "RECURRING_PASS_MAX_DURATION",
      "recurring pass validity cannot exceed 90 days; renew instead",
    );
  }
}

// ── Check-In Eligibility (Schedule Enforcement) ───────────────────────────

export type RecurringPassStatus = "active" | "suspended" | "revoked" | "expired";

export interface TimeWindow {
  /** "HH:MM" 24-hour, e.g. "09:00" */
  startTime: string;
  /** "HH:MM" 24-hour, e.g. "18:00" */
  endTime: string;
}

export type EligibilityReason =
  | "PASS_SUSPENDED"
  | "PASS_REVOKED"
  | "PASS_EXPIRED"
  | "OUTSIDE_PERMITTED_DAY"
  | "OUTSIDE_PERMITTED_TIME_WINDOW";

export type EligibilityResult =
  | { eligible: true }
  | { eligible: false; reason: EligibilityReason };

/**
 * Converts a "HH:MM" time-of-day string to minutes since midnight, for
 * numeric comparison against `now`'s local minutes-of-day.
 */
function timeToMinutes(time: string): number {
  const [hoursStr, minutesStr] = time.split(":");
  const hours = Number(hoursStr);
  const minutes = Number(minutesStr);
  return hours * 60 + minutes;
}

/**
 * Determines whether a Recurring_Pass may be used for check-in `now`
 * (Requirement 12.3, Property 20: Recurring Pass Schedule Enforcement).
 *
 * Eligibility requires, in order:
 *   1. `passStatus` is `active` (not suspended, revoked, or expired).
 *   2. `now`'s day-of-week (0=Sun..6=Sat, matching `permittedDays` in
 *      schema.ts) is present in `permittedDays`.
 *   3. `now`'s time-of-day falls within `[timeWindow.startTime,
 *      timeWindow.endTime]` inclusive, when a `timeWindow` is supplied. A
 *      `null` `timeWindow` means no time restriction (day-of-week only).
 *
 * Returns `{ eligible: true }` or `{ eligible: false, reason }` — callers
 * map an ineligible result to `RECURRING_PASS_OUTSIDE_SCHEDULE` (422) for
 * schedule violations, distinguishing pass-status reasons for logging.
 */
export function isEligibleForCheckIn(
  now: Date,
  permittedDays: number[],
  timeWindow: TimeWindow | null,
  passStatus: RecurringPassStatus,
): EligibilityResult {
  if (passStatus === "suspended") {
    return { eligible: false, reason: "PASS_SUSPENDED" };
  }
  if (passStatus === "revoked") {
    return { eligible: false, reason: "PASS_REVOKED" };
  }
  if (passStatus === "expired") {
    return { eligible: false, reason: "PASS_EXPIRED" };
  }

  const dayOfWeek = now.getDay(); // 0=Sun..6=Sat
  if (!permittedDays.includes(dayOfWeek)) {
    return { eligible: false, reason: "OUTSIDE_PERMITTED_DAY" };
  }

  if (timeWindow) {
    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    const startMinutes = timeToMinutes(timeWindow.startTime);
    const endMinutes = timeToMinutes(timeWindow.endTime);
    if (nowMinutes < startMinutes || nowMinutes > endMinutes) {
      return { eligible: false, reason: "OUTSIDE_PERMITTED_TIME_WINDOW" };
    }
  }

  return { eligible: true };
}

// ── Status State Machine ──────────────────────────────────────────────────

const ALLOWED_TRANSITIONS: Record<RecurringPassStatus, RecurringPassStatus[]> = {
  active: ["suspended", "revoked", "expired"],
  suspended: ["active", "revoked"],
  revoked: [],
  expired: [],
};

function assertTransition(from: RecurringPassStatus, to: RecurringPassStatus): void {
  const allowed = ALLOWED_TRANSITIONS[from];
  if (!allowed.includes(to)) {
    throw new DomainError(
      "INVALID_TRANSITION",
      `recurring pass cannot transition from '${from}' to '${to}'`,
    );
  }
}

/**
 * Suspends an active Recurring_Pass (Requirement 12.4). Throws DomainError
 * if `currentStatus` is not `active`.
 */
export function suspend(currentStatus: RecurringPassStatus): RecurringPassStatus {
  assertTransition(currentStatus, "suspended");
  return "suspended";
}

/**
 * Revokes a Recurring_Pass from `active` or `suspended` (Requirement 12.4).
 * Throws DomainError if `currentStatus` is already `revoked` or `expired`.
 */
export function revoke(currentStatus: RecurringPassStatus): RecurringPassStatus {
  assertTransition(currentStatus, "revoked");
  return "revoked";
}

/**
 * Reactivates a `suspended` Recurring_Pass back to `active`. Throws
 * DomainError if `currentStatus` is not `suspended`.
 */
export function reactivate(currentStatus: RecurringPassStatus): RecurringPassStatus {
  assertTransition(currentStatus, "active");
  return "active";
}

// ── Attendance-Log Aggregation ────────────────────────────────────────────

export interface AttendanceCheckInRecord {
  /** Check-in timestamp (direction = "in"). */
  checkInAt: Date;
  /** Check-out timestamp (direction = "out"), if the visit has concluded. */
  checkOutAt: Date | null;
}

export interface DailyAttendanceSummary {
  /** Calendar date in "YYYY-MM-DD" form, in the record's local time. */
  date: string;
  checkInCount: number;
  totalDurationMinutes: number;
}

/**
 * Formats a Date as a "YYYY-MM-DD" calendar-day key in local time, used to
 * group attendance records by day (Requirement 12.6).
 */
function toDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Aggregates a Recurring_Pass's check-in records into a per-calendar-day
 * attendance log (Requirement 12.6): each day the pass was used gets a
 * summary of how many check-ins occurred and the total minutes spent
 * checked in that day.
 *
 * Records are grouped by the calendar day of `checkInAt` (in local time).
 * A record with a `null` `checkOutAt` (still checked in, or checked out on
 * a later day without a matching same-day check-out) contributes 0 minutes
 * to `totalDurationMinutes` for that check-in's day — callers may re-run
 * aggregation once the check-out is recorded. Results are sorted
 * ascending by `date`.
 */
export function aggregateAttendance(
  checkInRecords: AttendanceCheckInRecord[],
): DailyAttendanceSummary[] {
  const byDate = new Map<string, { checkInCount: number; totalDurationMinutes: number }>();

  for (const record of checkInRecords) {
    const dateKey = toDateKey(record.checkInAt);
    const durationMinutes =
      record.checkOutAt !== null
        ? Math.max(0, (record.checkOutAt.getTime() - record.checkInAt.getTime()) / 60_000)
        : 0;

    const existing = byDate.get(dateKey);
    if (existing) {
      existing.checkInCount += 1;
      existing.totalDurationMinutes += durationMinutes;
    } else {
      byDate.set(dateKey, { checkInCount: 1, totalDurationMinutes: durationMinutes });
    }
  }

  return Array.from(byDate.entries())
    .map(([date, summary]) => ({
      date,
      checkInCount: summary.checkInCount,
      totalDurationMinutes: Math.round(summary.totalDurationMinutes),
    }))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}
