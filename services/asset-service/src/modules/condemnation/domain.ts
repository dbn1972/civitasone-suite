/**
 * Condemnation domain logic — pure functions, no IO.
 */

export class DomainError extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = "DomainError";
  }
}

/**
 * Maker-checker: committee recommendation approver cannot be the creator.
 */
export function assertMakerChecker(createdBy: string, approverActorId: string): void {
  if (createdBy === approverActorId) {
    throw new DomainError("MAKER_CHECKER_VIOLATION", "recommendation approver cannot be the same as creator (GFR Rule 196)");
  }
}

/**
 * Validate that the auction bid meets the reserve/floor value.
 */
export function assertBidMeetsFloor(bidMinor: bigint, floorMinor: bigint): void {
  if (bidMinor < floorMinor) {
    throw new DomainError("BID_BELOW_FLOOR", `bid ${bidMinor} is below floor value ${floorMinor}`);
  }
}

/**
 * Valid condemnation survey conditions.
 */
export const CONDITION_VALUES = ["good", "fair", "poor", "unserviceable", "beyond_repair"] as const;

/**
 * Valid committee decisions.
 */
export const DECISION_VALUES = ["condemn", "repair", "continue_use", "downgrade"] as const;

/**
 * Determine if an asset is eligible for condemnation based on survey.
 */
export function isCondemnableCondition(condition: string): boolean {
  return condition === "unserviceable" || condition === "beyond_repair";
}

/**
 * Compute depreciation stop date — the date the asset should stop depreciating.
 * This is the date of condemnation approval (asset is retired).
 */
export function computeRetirementDate(approvalDate: Date): string {
  return approvalDate.toISOString().slice(0, 10);
}

/**
 * GAP-ASSETS-CONDEMNATION-02 (consumer integrity): an optimistic-lock update
 * that matched no row means the client's version was stale (or the record is
 * gone). Throwing rolls the whole transaction back, so NO side effect (asset
 * condemned/disposed, finance receipt, GL journal) is applied on a stale write.
 */
export function assertRowUpdated(updatedRows: number, code: string): void {
  if (updatedRows === 0) {
    throw new DomainError(code, "record changed or was not found (stale version); nothing was applied");
  }
}

/** Only a pending recommendation can be approved. */
export function assertRecommendationPending(status: string): void {
  if (status !== "pending") {
    throw new DomainError("RECOMMENDATION_NOT_PENDING", `recommendation is ${status}, not pending`);
  }
}

/**
 * An auction may only be opened on an APPROVED "condemn" recommendation for
 * the same asset -- otherwise the committee maker-checker is bypassed by
 * auctioning straight off a pending (or repair/continue) recommendation.
 */
export function assertAuctionable(
  rec: { status: string; decision: string; assetId: string } | null | undefined,
  assetId: string,
): void {
  if (!rec) throw new DomainError("RECOMMENDATION_NOT_FOUND", "recommendation not found");
  if (rec.status !== "approved") throw new DomainError("RECOMMENDATION_NOT_APPROVED", `recommendation is ${rec.status}, not approved`);
  if (rec.decision !== "condemn") throw new DomainError("RECOMMENDATION_NOT_CONDEMN", `recommendation decision is ${rec.decision}, not condemn`);
  if (rec.assetId !== assetId) throw new DomainError("ASSET_MISMATCH", "auction asset differs from the recommendation's asset");
}

/** A completed auction must never be completed again (double receipt / GL). */
export function assertAuctionOpen(status: string): void {
  if (status !== "pending") {
    throw new DomainError("AUCTION_NOT_OPEN", `auction is ${status}, not pending`);
  }
}

/**
 * One approved condemnation is sold once: refuse a second auction while one
 * for the same recommendation is pending or already completed (two completed
 * auctions would post the sale receipt and disposal GL journal twice).
 * Backed by the partial unique index in migration 0033.
 */
export function assertNoActiveAuction(existingActive: number): void {
  if (existingActive > 0) {
    throw new DomainError("AUCTION_ALREADY_EXISTS", "an auction for this recommendation is already pending or completed");
  }
}
