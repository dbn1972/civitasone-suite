/**
 * SVC-033 — Allocation & distribution pure domain.
 *
 * An original allocation held by an office is distributed to subordinate
 * offices, effective-dated, with conditions, and acknowledged by the receiving
 * office. Distributions in aggregate may never exceed the parent allocation.
 * No DB, no HTTP, no queue.
 */
import { DomainError } from "./domain.js";

export type DistributionStatus = "draft" | "issued" | "acknowledged" | "returned";

/** Amount of the parent allocation still available to distribute. */
export function remainingDistributable(allocatedMinor: bigint, alreadyDistributedMinor: bigint): bigint {
  return allocatedMinor - alreadyDistributedMinor;
}

/** A distribution moves a strictly positive amount. */
export function assertDistributionAmountValid(amountMinor: bigint): void {
  if (amountMinor <= 0n) {
    throw new DomainError("INVALID_AMOUNT", "distribution amount must be positive");
  }
}

/** A distribution must go to a different office than the one issuing it. */
export function assertDistinctOffices(fromOfficeId: string, toOfficeId: string): void {
  if (fromOfficeId === toOfficeId) {
    throw new DomainError("INVALID_DISTRIBUTION", "distributing and receiving offices must differ");
  }
}

/**
 * Block over-distribution: the amount being distributed must fit within what
 * remains of the parent allocation (allocated − already distributed). Keeps
 * total distributions conserved against the original allocation.
 */
export function assertWithinAllocation(allocatedMinor: bigint, alreadyDistributedMinor: bigint, requestedMinor: bigint): void {
  const remaining = remainingDistributable(allocatedMinor, alreadyDistributedMinor);
  if (requestedMinor > remaining) {
    throw new DomainError(
      "DISTRIBUTION_EXCEEDS_ALLOCATION",
      `distribution ${requestedMinor} paise exceeds remaining allocation ${remaining} paise (allocated=${allocatedMinor}, distributed=${alreadyDistributedMinor})`,
    );
  }
}

const TRANSITIONS: Record<DistributionStatus, DistributionStatus[]> = {
  draft:        ["issued"],
  issued:       ["acknowledged", "returned"],
  acknowledged: [],
  returned:     [],
};

export function assertDistributionTransition(from: DistributionStatus, to: DistributionStatus): void {
  if (!TRANSITIONS[from]?.includes(to)) {
    throw new DomainError("INVALID_TRANSITION", `cannot move distribution from '${from}' to '${to}'`);
  }
}

/**
 * Acknowledgement separation of duties: the receiving office's acknowledger
 * must differ from the officer who issued the distribution, so a distribution
 * is never self-acknowledged.
 */
export function assertAcknowledgerDistinct(issuedBy: string, acknowledgerId: string): void {
  if (issuedBy === acknowledgerId) {
    throw new DomainError(
      "MAKER_CHECKER_VIOLATION",
      "acknowledger must differ from the officer who issued the distribution (maker-checker)",
    );
  }
}
