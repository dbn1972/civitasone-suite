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
 * GAP-WORKS-EXECUTION-PHOTOS-NEW-05: a stored-file reference must be one this tenant's presign endpoint issued
 * (`uploads/<tenantId>/<category>/<actor>/<uuid>.<ext>`). Otherwise a caller could register another tenant's object, or a
 * path-traversal string, as evidence on their own work.
 */
export function isTenantUploadKey(tenantId: string, key: string): boolean {
  return key.startsWith(`uploads/${tenantId}/`) && !key.includes("..") && !key.includes("\\");
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

/**
 * D4c #41 (GAP-WORKS-EXECUTION-WORKID-07): what stands between a work and being closed. A work may not be closed while
 * an issue is open or any scope with a target is below it (physical progress under 100%), unless it is closed as
 * dropped/closed (foreclosed) with a DAO reason. `target` null/0 means the scope carries no measurable target.
 */
export interface ClosureFacts {
  openIssues: number;
  scopes: Array<{ target: number | null; achieved: number }>;
}
export type ClosureBlocker = "OPEN_ISSUES" | "PROGRESS_BELOW_100";

export function closureBlockers(facts: ClosureFacts): ClosureBlocker[] {
  const out: ClosureBlocker[] = [];
  if (facts.openIssues > 0) out.push("OPEN_ISSUES");
  if (facts.scopes.some((s) => s.target !== null && s.target > 0 && s.achieved < s.target)) out.push("PROGRESS_BELOW_100");
  return out;
}

export const CLOSURE_BLOCKER_TEXT: Record<ClosureBlocker, string> = {
  OPEN_ISSUES: "the work still has open issues",
  PROGRESS_BELOW_100: "physical progress is below 100%",
};
