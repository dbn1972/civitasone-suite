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

export function assertIndentApproved(status: string): void {
  if (status !== "approved") {
    throw new DomainError("INDENT_NOT_APPROVED", `PO requires an approved indent, got '${status}'`);
  }
}
