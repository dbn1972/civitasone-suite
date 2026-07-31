/**
 * redemptions/domain.ts — Pure domain logic for points redemption.
 * Handles validation, partial/full redemption, void/reversal.
 */

export type RedemptionStatus = "pending" | "fulfilled" | "cancelled" | "voided";

/**
 * Validate that a redemption can be made.
 */
export function validateRedemption(input: {
  requestedPoints: bigint;
  availableBalance: bigint;
  minRedemptionThreshold?: bigint;
  enrolmentStatus: string;
}): { valid: boolean; error?: string } {
  if (input.enrolmentStatus !== "active") {
    return { valid: false, error: "enrolment is not active" };
  }
  if (input.requestedPoints <= BigInt(0)) {
    return { valid: false, error: "points must be positive" };
  }
  if (input.requestedPoints > input.availableBalance) {
    return { valid: false, error: "insufficient points balance" };
  }
  if (input.minRedemptionThreshold && input.requestedPoints < input.minRedemptionThreshold) {
    return { valid: false, error: `minimum redemption is ${input.minRedemptionThreshold} points` };
  }
  return { valid: true };
}

/**
 * Determine if a redemption can be voided.
 * Only pending or fulfilled redemptions can be voided.
 */
export function canVoid(status: string): boolean {
  return status === "pending" || status === "fulfilled";
}

/**
 * Calculate the new balance after a redemption.
 */
export function balanceAfterRedemption(currentBalance: bigint, redeemedPoints: bigint): bigint {
  const newBalance = currentBalance - redeemedPoints;
  return newBalance < BigInt(0) ? BigInt(0) : newBalance;
}

/**
 * Calculate the balance after voiding a redemption (points returned).
 */
export function balanceAfterVoid(currentBalance: bigint, voidedPoints: bigint): bigint {
  return currentBalance + voidedPoints;
}

/**
 * Check if redemption is full (uses all available balance).
 */
export function isFullRedemption(requestedPoints: bigint, availableBalance: bigint): boolean {
  return requestedPoints === availableBalance;
}
