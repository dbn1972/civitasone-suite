export class DomainError extends Error {
  constructor(public code: string, message: string) {
    super(`[${code}] ${message}`);
    this.name = "DomainError";
  }
}

export type PoStatus = "draft" | "approved" | "gem_placed" | "dispatched" | "closed" | "cancelled";

export function assertBudgetSufficient(available: bigint, requested: bigint): void {
  if (requested > available) {
    throw new DomainError("BUDGET_EXCEEDED", `PO value ${requested} paise exceeds sanction available ${available} paise`);
  }
}

export function assertCanDispatch(status: string): void {
  if (status !== "approved") {
    throw new DomainError("PO_NOT_APPROVED", `PO must be approved before dispatch, got '${status}'`);
  }
}
