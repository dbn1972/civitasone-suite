/**
 * Mid-Cycle Proration — Pure Domain Logic
 *
 * Computes prorated credits and charges when a subscription plan changes mid-cycle.
 * All monetary values are BigInt paise — no floating-point arithmetic is used.
 *
 * Formula (bigint floor division):
 *   credit = (daysRemaining × oldPlanPaise) / totalDays
 *   charge = (daysRemaining × newPlanPaise) / totalDays
 *
 * These produce separate invoice line items: one credit for unused old-plan time,
 * one charge for the remaining new-plan time.
 *
 * Validates: Requirements 13.3
 */

/**
 * Computes the prorated credit for the unused portion of the old plan.
 * Uses bigint floor division (truncation toward zero).
 *
 * @param daysRemaining - Days remaining in the current billing cycle (>= 0)
 * @param totalDays - Total days in the billing cycle (>= 1)
 * @param oldPlanPaise - Old plan price in paise (bigint, >= 0)
 * @returns Prorated credit amount in paise (bigint)
 * @throws Error if totalDays < 1, daysRemaining < 0, or oldPlanPaise < 0
 */
export function prorationCredit(
  daysRemaining: number,
  totalDays: number,
  oldPlanPaise: bigint,
): bigint {
  if (totalDays < 1) {
    throw new Error("totalDays must be at least 1");
  }
  if (daysRemaining < 0) {
    throw new Error("daysRemaining must be non-negative");
  }
  if (oldPlanPaise < 0n) {
    throw new Error("oldPlanPaise must be non-negative");
  }
  if (daysRemaining === 0) {
    return 0n;
  }

  return (BigInt(daysRemaining) * oldPlanPaise) / BigInt(totalDays);
}

/**
 * Computes the prorated charge for the remaining portion under the new plan.
 * Uses bigint floor division (truncation toward zero).
 *
 * @param daysRemaining - Days remaining in the current billing cycle (>= 0)
 * @param totalDays - Total days in the billing cycle (>= 1)
 * @param newPlanPaise - New plan price in paise (bigint, >= 0)
 * @returns Prorated charge amount in paise (bigint)
 * @throws Error if totalDays < 1, daysRemaining < 0, or newPlanPaise < 0
 */
export function prorationCharge(
  daysRemaining: number,
  totalDays: number,
  newPlanPaise: bigint,
): bigint {
  if (totalDays < 1) {
    throw new Error("totalDays must be at least 1");
  }
  if (daysRemaining < 0) {
    throw new Error("daysRemaining must be non-negative");
  }
  if (newPlanPaise < 0n) {
    throw new Error("newPlanPaise must be non-negative");
  }
  if (daysRemaining === 0) {
    return 0n;
  }

  return (BigInt(daysRemaining) * newPlanPaise) / BigInt(totalDays);
}

/**
 * Input for a full proration computation.
 */
export interface ProrationInput {
  daysRemaining: number;
  totalDays: number;
  oldPlanPaise: bigint;
  newPlanPaise: bigint;
}

/**
 * Result of a proration computation, representing separate invoice line items.
 */
export interface ProrationResult {
  /** Credit for unused old-plan time (always >= 0) */
  credit: bigint;
  /** Charge for remaining new-plan time (always >= 0) */
  charge: bigint;
  /** Net difference: charge - credit (positive = customer owes, negative = customer is owed) */
  netDifference: bigint;
}

/**
 * Computes the full mid-cycle proration: credit, charge, and net difference.
 * Produces values suitable for separate invoice line items.
 *
 * @param input - Proration parameters
 * @returns ProrationResult with credit, charge, and netDifference
 * @throws Error if any input values are invalid
 */
export function computeProration(input: ProrationInput): ProrationResult {
  const { daysRemaining, totalDays, oldPlanPaise, newPlanPaise } = input;

  const credit = prorationCredit(daysRemaining, totalDays, oldPlanPaise);
  const charge = prorationCharge(daysRemaining, totalDays, newPlanPaise);
  const netDifference = charge - credit;

  return { credit, charge, netDifference };
}
