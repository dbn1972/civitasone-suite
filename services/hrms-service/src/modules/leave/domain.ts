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
