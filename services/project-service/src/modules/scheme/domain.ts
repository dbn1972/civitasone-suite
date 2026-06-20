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
