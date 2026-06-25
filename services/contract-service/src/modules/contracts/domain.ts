export class DomainError extends Error {
  constructor(public code: string, message: string) {
    super(`[${code}] ${message}`);
    this.name = "DomainError";
  }
}

/**
 * Government contract lifecycle.
 *   draft      — created, not yet sanctioned (maker).
 *   approved   — sanctioned by a checker (SoD: != maker), award signed, not yet live.
 *   active     — in force; deliverables/milestones run; amendments allowed here.
 *   closed     — completed normally (all obligations discharged).
 *   terminated — ended early (default / convenience / breach); requires checker (SoD).
 */
export type ContractStatus = "draft" | "approved" | "active" | "closed" | "terminated";

const VALID_TRANSITIONS: Record<ContractStatus, ContractStatus[]> = {
  draft:      ["approved", "terminated"],
  approved:   ["active", "terminated"],
  active:     ["closed", "terminated"],
  closed:     [],
  terminated: [],
};

export function assertTransitionAllowed(from: string, to: ContractStatus): void {
  const allowed = VALID_TRANSITIONS[from as ContractStatus] ?? [];
  if (!allowed.includes(to)) {
    throw new DomainError("INVALID_TRANSITION", `contract cannot transition from '${from}' to '${to}'`);
  }
}

/** Segregation of duties: the approver/terminator (checker) must differ from the creator (maker). */
export function assertDistinctMakerChecker(creatorId: string, approverId: string): void {
  if (creatorId && approverId && creatorId === approverId) {
    throw new DomainError("SOD_VIOLATION", "maker and checker must be different actors (self-approval rejected)");
  }
}

/** Amendments (variations) are only valid on a contract that is in force. */
export function assertCanAmend(status: string): void {
  if (status !== "active") {
    throw new DomainError("INVALID_STATUS", `only active contracts can be amended, got '${status}'`);
  }
}

export function assertNotExpired(expiry: string): void {
  if (new Date(expiry) < new Date()) {
    throw new DomainError("CONTRACT_EXPIRED", `contract expired on ${expiry}`);
  }
}
