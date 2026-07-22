/**
 * Billing domain logic — e-MB finalization sequence, bill finalization,
 * quantity checks, and net payable calculation.
 */

/**
 * e-MB finalization sequence: SO → SDO → Estimator → DO
 */
export function eMbFinalizationSequence(): string[] {
  return ["so_finalized", "sdo_finalized", "estimator_finalized", "do_finalized"];
}

/**
 * Bill finalization sequence: SO → SDO → Auditor → DAO → DO
 */
export function billFinalizationSequence(): string[] {
  return ["so_finalized", "sdo_finalized", "auditor_finalized", "dao_finalized", "do_finalized"];
}

/**
 * Check if a bill can be created from an MB.
 * MB must be fully finalized (do_finalized).
 */
export function canCreateBill(mbStatus: string): boolean {
  return mbStatus === "do_finalized";
}

/**
 * FR-BIL-011: Check if billed quantity exceeds BoQ approved quantity.
 */
export function billedQuantityExceedsBoq(billed: number, boqApproved: number): boolean {
  return billed > boqApproved;
}

/**
 * Calculate net payable: gross - deductions.
 */
export function calculateNetPayable(gross: bigint, deductions: bigint): bigint {
  return gross - deductions;
}

/**
 * Validate finalization step is the correct next step in sequence.
 */
export function isValidNextStep(currentStatus: string, nextStatus: string, sequence: string[]): boolean {
  if (currentStatus === "draft") {
    return nextStatus === sequence[0];
  }
  const currentIdx = sequence.indexOf(currentStatus);
  if (currentIdx === -1) return false;
  const nextIdx = sequence.indexOf(nextStatus);
  return nextIdx === currentIdx + 1;
}
