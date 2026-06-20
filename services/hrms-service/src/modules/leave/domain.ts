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

export function countWorkingDays(fromDate: string, toDate: string): number {
  const from = new Date(fromDate);
  const to   = new Date(toDate);
  let count  = 0;
  const cur  = new Date(from);
  while (cur <= to) {
    const dow = cur.getDay();
    if (dow !== 0 && dow !== 6) count++;
    cur.setDate(cur.getDate() + 1);
  }
  return Math.max(count, 1);
}

export function assertLeaveAppStatusTransition(current: string, next: string): void {
  const allowed: Record<string, string[]> = {
    draft:   ["pending"],
    pending: ["approved", "rejected"],
    approved: ["cancelled"],
    rejected: [],
    cancelled: [],
  };
  if (!(allowed[current] ?? []).includes(next)) {
    throw new DomainError("INVALID_STATUS_TRANSITION", `cannot move leave from '${current}' to '${next}'`);
  }
}
