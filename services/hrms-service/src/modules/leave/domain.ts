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

export { countWorkingDays } from "./holidays.js";

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
