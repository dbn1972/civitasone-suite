/**
 * cycle-count module — pure domain logic for cycle count operations.
 *
 * Key rules:
 *   - Compare physical count vs system on-hand quantity
 *   - Auto-adjustment threshold: 5% of system qty or 10 units (whichever is greater)
 *   - Variance within threshold → auto-post adjustment
 *   - Variance above threshold → requires approval before posting
 *
 * Validates: Requirements 14.7, 14.8, 14.9
 */
import { DomainError } from "../../shared/domain.js";

/** Status of a cycle count record. */
export type CycleCountStatus = "pending" | "auto_posted" | "pending_approval" | "approved" | "rejected";

/** Input for computing a cycle count result. */
export interface CycleCountInput {
  /** System on-hand quantity at time of count. */
  systemQty: number;
  /** Physical count entered by the user. */
  physicalQty: number;
  /** Reason code for the adjustment (from tenant's configured list). */
  reasonCode: string;
  /** Custom threshold override (percentage, e.g. 5 for 5%). Defaults to 5. */
  thresholdPct?: number;
  /** Custom absolute threshold override in units. Defaults to 10. */
  thresholdUnits?: number;
}

/** Result of a cycle count evaluation. */
export interface CycleCountResult {
  /** Absolute variance (physicalQty - systemQty). Positive = surplus, negative = shortage. */
  variance: number;
  /** Absolute value of the variance. */
  absVariance: number;
  /** The effective auto-adjustment threshold (max of pct-based and unit-based). */
  autoAdjustThreshold: number;
  /** Whether the variance is within the auto-adjust threshold. */
  withinThreshold: boolean;
  /** Resulting status: auto_posted if within threshold, pending_approval if above. */
  status: CycleCountStatus;
}

/**
 * Computes the auto-adjustment threshold for a given system quantity.
 *
 * The threshold is the GREATER of:
 *   - `thresholdPct`% of system qty (default 5%)
 *   - `thresholdUnits` absolute units (default 10)
 *
 * @param systemQty - Current system on-hand quantity.
 * @param thresholdPct - Percentage threshold (default 5).
 * @param thresholdUnits - Absolute unit threshold (default 10).
 * @returns The effective threshold value.
 */
export function computeAutoAdjustThreshold(
  systemQty: number,
  thresholdPct: number = 5,
  thresholdUnits: number = 10,
): number {
  const pctThreshold = Math.ceil((thresholdPct / 100) * Math.abs(systemQty));
  return Math.max(pctThreshold, thresholdUnits);
}

/**
 * Evaluates a cycle count and determines whether it can be auto-posted
 * or requires approval.
 *
 * @param input - The cycle count input parameters.
 * @returns CycleCountResult with variance details and status.
 * @throws DomainError if physicalQty is negative.
 */
export function evaluateCycleCount(input: CycleCountInput): CycleCountResult {
  const { systemQty, physicalQty, thresholdPct = 5, thresholdUnits = 10 } = input;

  if (physicalQty < 0) {
    throw new DomainError("INVALID_PHYSICAL_QTY", "Physical count cannot be negative");
  }

  if (!input.reasonCode || input.reasonCode.trim().length === 0) {
    throw new DomainError("REASON_CODE_REQUIRED", "A reason code is required for cycle count adjustments");
  }

  const variance = physicalQty - systemQty;
  const absVariance = Math.abs(variance);
  const autoAdjustThreshold = computeAutoAdjustThreshold(systemQty, thresholdPct, thresholdUnits);
  const withinThreshold = absVariance <= autoAdjustThreshold;
  const status: CycleCountStatus = withinThreshold ? "auto_posted" : "pending_approval";

  return {
    variance,
    absVariance,
    autoAdjustThreshold,
    withinThreshold,
    status,
  };
}

/**
 * Validates that a reason code is in the tenant's configured list.
 *
 * @param reasonCode - The provided reason code.
 * @param allowedCodes - Tenant's configured reason codes.
 * @throws DomainError if code is not in the allowed list.
 */
export function validateReasonCode(reasonCode: string, allowedCodes: string[]): void {
  if (!allowedCodes.includes(reasonCode)) {
    throw new DomainError(
      "INVALID_REASON_CODE",
      `Reason code '${reasonCode}' is not in the tenant's configured list`,
    );
  }
}
