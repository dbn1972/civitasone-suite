export class DomainError extends Error {
  constructor(public code: string, message: string) {
    super(`[${code}] ${message}`);
    this.name = "DomainError";
  }
}

export function assertFundReleaseWithinAllocation(
  allocationMinor: bigint,
  alreadyReleasedMinor: bigint,
  newAmountMinor: bigint
): void {
  const total = alreadyReleasedMinor + newAmountMinor;
  if (total > allocationMinor) {
    throw new DomainError(
      "ALLOCATION_EXCEEDED",
      `fund release ${newAmountMinor} paise would exceed component allocation of ${allocationMinor} paise (already released: ${alreadyReleasedMinor})`
    );
  }
}

export function assertFundReleaseCanDisburse(status: string): void {
  if (status !== "approved") {
    throw new DomainError("FUND_RELEASE_NOT_APPROVED", `fund release status is '${status}', must be approved to disburse`);
  }
}

/**
 * GAP2-PROJECTS-FUND-RELEASES-07: separation of duties on a money-out
 * disbursement. The actor who CREATED the fund release must not be the one who
 * disburses it — otherwise a single project_manager/finance_officer could both
 * raise and release funds with no second signatory. Mirrors grant-service's
 * submitDisbursementForApproval SoD guard (createdBy === actorId → 403).
 * Enforced in BOTH the HTTP command (synchronous 403) and the consumer
 * transaction (defence in depth — a replayed/forged message cannot bypass it).
 */
export function assertFundReleaseDisburserDiffersFromCreator(
  createdBy: string | null | undefined,
  actorId: string,
): void {
  if (createdBy && createdBy === actorId) {
    throw new DomainError(
      "SOD_VIOLATION",
      "the actor who created a fund release may not disburse it (separation of duties)",
    );
  }
}

export interface ComponentProgress {
  weightPct: number;
  physicalPct: number;
}

export function computeWeightedPhysicalProgress(components: ComponentProgress[]): number {
  const totalWeight = components.reduce((s, c) => s + c.weightPct, 0);
  if (totalWeight === 0) return 0;
  const weightedSum = components.reduce((s, c) => s + c.physicalPct * c.weightPct, 0);
  return weightedSum / totalWeight;
}
