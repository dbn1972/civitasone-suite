/**
 * Billing domain logic — e-MB finalization sequence, bill finalization,
 * quantity checks, and net payable calculation.
 */
import { calculateBoqAmount } from "../boq/domain.js";

export interface MeasurementLine {
  boqItemId: string;
  quantity: string | number;
}

/**
 * Sum quantity × BoQ rate over a set of measurement lines to get the total
 * value of work actually measured — the ceiling a bill referencing these
 * measurements (via its MB) may not exceed. A boqItemId with no entry in
 * `rateByBoqItem` contributes 0 (defensive; should not happen since every
 * measurement is validated against a real BoQ item at record time).
 */
export function computeMeasuredValueMinor(
  lines: MeasurementLine[],
  rateByBoqItem: Map<string, bigint>,
): bigint {
  return lines.reduce((sum, m) => {
    const rate = rateByBoqItem.get(m.boqItemId);
    if (rate === undefined) return sum;
    return sum + calculateBoqAmount(rate, Number(m.quantity));
  }, 0n);
}

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
 * Bug fix (works-billing-integrity #2): the award cited on a bill must
 * actually belong to the work being billed. Without this, the award-ceiling
 * check (billAmountExceedsAward) can be defeated by citing a different
 * work's award with a higher/unspent ceiling.
 */
export function awardBelongsToWork(award: { workId: string }, workId: string): boolean {
  return award.workId === workId;
}

/**
 * FR-BIL-012: cumulative gross bill amount (prior bills + this bill) must not
 * exceed the accepted award ceiling.
 */
export function billAmountExceedsAward(
  priorBilledGross: bigint,
  newBillGross: bigint,
  awardCeiling: bigint,
): boolean {
  return priorBilledGross + newBillGross > awardCeiling;
}

/**
 * No-3-way-match fix: a bill's gross amount must not exceed the value of the
 * work actually measured and recorded against its referenced MB (sum of
 * quantity × BoQ rate over every measurement line under that MB — see
 * boq/domain.ts calculateBoqAmount). This is the real "was the work done"
 * check; billAmountExceedsAward only bounds total spend against the award
 * ceiling and says nothing about whether any work was measured at all.
 */
export function billAmountExceedsMeasuredValue(
  billGross: bigint,
  measuredValueMinor: bigint,
): boolean {
  return billGross > measuredValueMinor;
}

/**
 * A bill's MB must belong to the same work (and the same award) it is being
 * billed against — otherwise a caller could cite a finalized MB issued for a
 * different work/award to justify an unrelated bill's measured-value check.
 */
export function mbBelongsToBill(
  mb: { workId: string; awardId: string },
  workId: string,
  awardId: string,
): boolean {
  return mb.workId === workId && mb.awardId === awardId;
}

/** Terminal step in bill finalization — triggers finance hand-off. */
export function isTerminalBillStatus(status: string): boolean {
  return status === "do_finalized";
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
