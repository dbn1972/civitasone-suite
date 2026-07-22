/**
 * Approval domain logic — pure functions for AA/TS approval type resolution,
 * finalization rules, and DAO gate enforcement.
 */

export interface Approval {
  id: string;
  status: string;
  approvalType?: string;
  approvedAmountMinor?: bigint;
}

/**
 * BR-009 / BR-012: First approval = Original, subsequent = Revised.
 */
export function resolveApprovalType(existingCount: number): "original" | "revised" {
  return existingCount === 0 ? "original" : "revised";
}

/**
 * Check if an AA or TS can be finalized.
 * Must be in 'draft' status.
 */
export function canFinalize(approval: Approval): { allowed: boolean; reason?: string } {
  if (approval.status !== "draft") {
    return { allowed: false, reason: `Cannot finalize: current status is '${approval.status}', must be 'draft'` };
  }
  return { allowed: true };
}

/**
 * BR-011: DAO finalization is required before TS entry.
 * Work status must be 'dao_finalized' or 'ts_eligible'.
 */
export function isDaoFinalizationRequired(workStatus: string): boolean {
  return workStatus === "draft";
}

/**
 * BR-011: Check if TS entry is allowed based on work proposal status.
 * Proposal must be DAO-finalized before TS can be entered.
 */
export function canEnterTS(workStatus: string): { allowed: boolean; blockingReason?: string } {
  if (workStatus === "draft") {
    return { allowed: false, blockingReason: "DAO finalization is required before TS entry (BR-011)" };
  }
  if (workStatus === "dao_finalized" || workStatus === "ts_eligible") {
    return { allowed: true };
  }
  return { allowed: true };
}
