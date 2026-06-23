export class DomainError extends Error {
  constructor(public code: string, message: string) {
    super(`[${code}] ${message}`);
    this.name = "DomainError";
  }
}

export type PoStatus = "draft" | "pending" | "approved" | "gem_placed" | "dispatched" | "closed" | "cancelled";

const VALID_TRANSITIONS: Record<PoStatus, PoStatus[]> = {
  draft:       ["pending", "approved"],
  pending:     ["approved", "cancelled"],
  approved:    ["dispatched", "closed", "cancelled"],
  gem_placed:  ["dispatched", "closed"],
  dispatched:  ["closed"],
  closed:      [],
  cancelled:   [],
};

export function assertTransitionAllowed(from: string, to: PoStatus): void {
  const allowed = VALID_TRANSITIONS[from as PoStatus] ?? [];
  if (!allowed.includes(to)) {
    throw new DomainError("INVALID_TRANSITION", `PO cannot transition from '${from}' to '${to}'`);
  }
}

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
