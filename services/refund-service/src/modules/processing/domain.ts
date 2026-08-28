// "superseded" (SEQ-1): assigned to a prior round's "approved" rows when a
// request is returned for correction — see repo.supersedeApprovals, called
// from processing/consumer.ts's returnRequest handler. Without this,
// getMaxApprovalLevel would keep counting an approval from BEFORE the
// return forever, permanently locking a fresh level-1 review out (rejected
// as "out of sequence") while making an unreviewed level-2 rubber-stamp of
// the corrected resubmission look like the *expected* next action.
export const APPROVAL_DECISIONS = ["approved", "rejected", "returned", "superseded"] as const;
export type ApprovalDecision = (typeof APPROVAL_DECISIONS)[number];

export const APPROVAL_LEVELS = {
  CHECKER: 1,
  AUTHORIZER: 2,
} as const;

export function getNextApprovalLevel(currentLevel: number): number | null {
  if (currentLevel < APPROVAL_LEVELS.AUTHORIZER) return currentLevel + 1;
  return null;
}

export function isFullyApproved(level: number): boolean {
  return level >= APPROVAL_LEVELS.AUTHORIZER;
}
