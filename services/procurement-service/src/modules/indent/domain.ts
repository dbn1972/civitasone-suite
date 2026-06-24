export class DomainError extends Error {
  constructor(public code: string, message: string) {
    super(`[${code}] ${message}`);
    this.name = "DomainError";
  }
}

export type IndentStatus = "draft" | "pending" | "tender_required" | "approved" | "rejected" | "closed";

const VALID_TRANSITIONS: Record<IndentStatus, IndentStatus[]> = {
  draft:           ["pending"],
  pending:         ["approved", "rejected", "tender_required"],
  tender_required: ["approved", "rejected"],
  approved:        ["closed"],
  rejected:        [],
  closed:          [],
};

export function assertTransitionAllowed(from: string, to: IndentStatus): void {
  const allowed = VALID_TRANSITIONS[from as IndentStatus] ?? [];
  if (!allowed.includes(to)) {
    throw new DomainError("INVALID_TRANSITION", `indent cannot transition from '${from}' to '${to}'`);
  }
}

/** Segregation of duties: the approver (checker) must differ from the creator (maker). */
export function assertDistinctMakerChecker(creatorId: string, approverId: string): void {
  if (creatorId && approverId && creatorId === approverId) {
    throw new DomainError("SOD_VIOLATION", "maker and checker must be different actors (self-approval rejected)");
  }
}

export function assertIndentApproved(status: string): void {
  if (status !== "approved") {
    throw new DomainError("INDENT_NOT_APPROVED", `PO requires an approved indent, got '${status}'`);
  }
}
