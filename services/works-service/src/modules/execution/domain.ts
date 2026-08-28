/**
 * Execution domain logic — closure eligibility, progress validation,
 * parent/split consistency, physical completion preconditions.
 */

export interface WorkWithAgreement {
  id: string;
  status: string;
  hasAgreement: boolean;
  hasSplits: boolean;
  allSplitsClosed: boolean;
  hasPhysicalCompletion: boolean;
}

export interface WorkSplit {
  id: string;
  status: string;
}

/**
 * Determine closure eligibility based on BR-029 to BR-034:
 * - "closed": work without agreement can be closed (dropped or no tender)
 * - "dropped": work can be dropped at any stage before physical completion
 * - "completion": work with agreement and physical completion certificate
 * - null: cannot close yet
 */
export function closureEligibility(work: WorkWithAgreement): "closed" | "dropped" | "completion" | null {
  // If no agreement → can be closed or dropped
  if (!work.hasAgreement) {
    return "closed";
  }

  // If has physical completion → eligible for completion closure
  if (work.hasPhysicalCompletion) {
    return "completion";
  }

  // Has agreement but no physical completion → can only be dropped
  return "dropped";
}

/**
 * BR-035: Physical completion requires an agreement to exist.
 */
export function canRecordPhysicalCompletion(hasAgreement: boolean): boolean {
  return hasAgreement;
}

/**
 * Validate that progress does not exceed target.
 */
export function validateProgressNotExceedTarget(cumulative: number, target: number): boolean {
  return cumulative <= target;
}

/**
 * Bug fix (works-billing-integrity #5): a progress delta that would take
 * cumulative achievement backward (i.e. a negative delta) is only allowed
 * when it is an explicit, distinctly-flagged correction — never silently.
 */
export function canApplyProgressDelta(delta: number, correctionReason?: string | null): boolean {
  if (delta >= 0) return true;
  return typeof correctionReason === "string" && correctionReason.trim().length > 0;
}

/**
 * BR-032: Parent/split consistency — parent cannot transition to a status
 * unless all splits are at or beyond that status.
 * For closure: parent cannot close unless all splits are closed.
 */
export function parentSplitConsistency(
  parentStatus: string,
  splits: WorkSplit[],
  targetStatus: string
): boolean {
  if (splits.length === 0) return true;

  if (targetStatus === "closed" || targetStatus === "completion") {
    return splits.every(s => s.status === "closed");
  }

  return true;
}
