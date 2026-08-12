export const APPROVAL_DECISIONS = ["approved", "rejected", "returned"] as const;
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
