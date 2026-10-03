export class DomainError extends Error {
  constructor(public code: string, message: string) {
    super(`[${code}] ${message}`);
    this.name = "DomainError";
  }
}

export interface LeaveBalance {
  totalDays: number;
  balanceDays: number;
}

// ─── GAP-HR-LEAVE-APPLY-05: half-day units ─────────────────────────────────
// Half-day quantities are stored in NEW numeric columns (migration 0183); the
// integer columns keep a safe whole-day shadow. These helpers are the single
// place that decides which column a reader trusts.

export const LEAVE_DAY_PARTS = ["full", "first_half", "second_half", "short_leave"] as const;
export type LeaveDayPart = (typeof LEAVE_DAY_PARTS)[number];

/** Day units a part consumes when it is a single-day request. */
export function dayPartUnits(part: LeaveDayPart): number {
  return part === "full" ? 1 : 0.5;
}

/** True when the value is a positive multiple of 0.5. */
export function isHalfDayMultiple(n: number): boolean {
  return Number.isFinite(n) && n > 0 && Math.abs(n * 2 - Math.round(n * 2)) < 1e-9;
}

/** Numeric column values arrive as strings from postgres; null/undefined = unset. */
function num(v: string | number | null | undefined): number | null {
  if (v == null) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Exact leave days of an application row (0.5 granularity). */
export function exactAppliedDays(row: { daysApplied: number; daysAppliedExact?: string | number | null }): number {
  return num(row.daysAppliedExact) ?? row.daysApplied;
}

/** Exact balance of an allocation row (0.5 granularity). */
export function effectiveBalanceDays(row: { balanceDays: number; balanceDaysExact?: string | number | null }): number {
  return num(row.balanceDaysExact) ?? row.balanceDays;
}

export interface LeaveTenantConfig {
  halfDayEnabled: boolean;
  shortLeaveEnabled: boolean;
}

/** No row == both OFF: exactly the whole-day-only behaviour that predates the switch. */
export const DEFAULT_LEAVE_TENANT_CONFIG: LeaveTenantConfig = { halfDayEnabled: false, shortLeaveEnabled: false };

/**
 * GAP-HR-LEAVE-APPLY-05: gate a non-'full' day part on the tenant switch and
 * the leave type. CCS Rules allow half-day only for Casual Leave (CL); short
 * leave is likewise charged against CL here. A tenant that never enabled the
 * switch keeps rejecting everything but whole days.
 */
export function assertDayPartAllowed(part: LeaveDayPart, leaveCode: string, cfg: LeaveTenantConfig): void {
  if (part === "full") return;
  if (leaveCode.toUpperCase() !== "CL") {
    throw new DomainError("HALF_DAY_NOT_ALLOWED", "half-day and short leave can only be taken as Casual Leave (CL)");
  }
  if (part === "short_leave" ? !cfg.shortLeaveEnabled : !cfg.halfDayEnabled) {
    throw new DomainError(
      "HALF_DAY_NOT_ENABLED",
      part === "short_leave" ? "short leave is not enabled for this organisation" : "half-day leave is not enabled for this organisation",
    );
  }
}

/**
 * Existing pending/approved applications that actually block a new request.
 * Whole-day overlap always blocks. The one exception: a first-half request
 * may sit beside a second-half one on the same single date (and vice versa),
 * which is how two half days make a full day without double-booking.
 */
export function blockingOverlaps<T extends { fromDate: string; toDate: string; dayPart?: string | null }>(
  existing: T[], req: { fromDate: string; toDate: string; dayPart: LeaveDayPart },
): T[] {
  const opposite = req.dayPart === "first_half" ? "second_half" : req.dayPart === "second_half" ? "first_half" : null;
  if (!opposite) return existing;
  return existing.filter((e) => !(e.fromDate === req.fromDate && e.toDate === req.toDate && e.dayPart === opposite));
}

export function assertSufficientLeaveBalance(balance: LeaveBalance, daysApplied: number): void {
  if (daysApplied > balance.balanceDays) {
    throw new DomainError(
      "INSUFFICIENT_LEAVE_BALANCE",
      `requested ${daysApplied} days exceeds balance of ${balance.balanceDays} days`
    );
  }
}

export function assertLeaveAppStatusTransition(current: string, next: string): void {
  const allowed: Record<string, string[]> = {
    draft:   ["pending"],
    // routing_failed: the leave-consumer's workflow.instance.create publish
    // came back rejected (e.g. the tenant has no active `leave_approval`
    // workflow.definitions row) -- see leave/consumer.ts's subscription to
    // "workflow.instance.rejected". This is a system/config failure, not a
    // human decision, so it is intentionally reachable only from `pending`
    // and is itself terminal for this automated path: nobody should be able
    // to "approve"/"reject" a request that was never actually routed to
    // anyone. An HR admin resolves it out-of-band (fix the tenant's
    // workflow definition, ask the employee to re-apply).
    pending: ["approved", "rejected", "routing_failed"],
    approved: ["cancelled"],
    rejected: [],
    cancelled: [],
    routing_failed: [],
  };
  if (!(allowed[current] ?? []).includes(next)) {
    throw new DomainError("INVALID_STATUS_TRANSITION", `cannot move leave from '${current}' to '${next}'`);
  }
}
