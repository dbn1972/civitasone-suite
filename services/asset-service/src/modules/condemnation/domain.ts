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
