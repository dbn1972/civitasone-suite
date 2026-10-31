export class DomainError extends Error {
  constructor(public code: string, message: string) {
    super(`[${code}] ${message}`);
    this.name = "DomainError";
  }
}

/**
 * Workflow definition every PO's approval instance is raised against
 * (po/consumer.ts). Seeded per tenant by workflow-service's provisioning
 * catalogue (F77); the PO create routes pre-check it exists.
 */
export const PO_APPROVAL_DEFINITION_CODE = "procurement_po_approval";

export type PoStatus = "draft" | "pending" | "approved" | "gem_placed" | "dispatched" | "closed" | "cancelled";

const VALID_TRANSITIONS: Record<PoStatus, PoStatus[]> = {
  // F102: a PO awaits its workflow approval in draft; a reject cancels it.
  draft:       ["pending", "approved", "cancelled"],
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

/**
 * F102: only a PO still awaiting approval (draft / pending) can be rejected;
 * an approved PO is cancelled through its own lifecycle, never by a reject.
 */
export function assertPoRejectable(status: string): void {
  if (status !== "draft" && status !== "pending") {
    throw new DomainError("PO_NOT_AWAITING_APPROVAL", `only a PO awaiting approval can be rejected, got '${status}'`);
  }
}

export function assertBudgetSufficient(available: bigint, requested: bigint): void {
  if (requested > available) {
    throw new DomainError("BUDGET_EXCEEDED", `PO value ${requested} paise exceeds sanction available ${available} paise`);
  }
}

/** Segregation of duties: PO approver (checker) must differ from creator (maker). */
export function assertDistinctMakerChecker(creatorId: string, approverId: string): void {
  if (creatorId && approverId && creatorId === approverId) {
    throw new DomainError("SOD_VIOLATION", "maker and checker must be different actors (self-approval rejected)");
  }
}

export function assertCanDispatch(status: string): void {
  if (status !== "approved") {
    throw new DomainError("PO_NOT_APPROVED", `PO must be approved before dispatch, got '${status}'`);
  }
}

/**
 * GAP-PROCUREMENT-ORDERS-DETAIL-03: dispatch is an irreversible vendor-facing
 * commitment, so it is a maker-checker action — the officer who dispatches must
 * differ from the officer who created the PO (GFR separation of duties). A PO's
 * own creator self-dispatching their order defeats the control.
 */
export function assertDispatcherDistinctFromCreator(creatorId: string, dispatcherId: string): void {
  if (creatorId && dispatcherId && creatorId === dispatcherId) {
    throw new DomainError("SOD_VIOLATION", "the officer dispatching a PO must differ from the officer who created it (self-dispatch rejected)");
  }
}
