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
 *
 * GAP2-WORKS-APPROVALS-07: this is now an ALLOW-LIST — TS entry is permitted
 * ONLY when the proposal is in a DAO-finalized state (dao_finalized or the
 * downstream ts_eligible). Previously the gate blocked only the exact `draft`
 * status and returned allowed:true for every other value, so a TS could be
 * entered against a proposal in any non-draft, non-finalized state (e.g.
 * `submitted`) — the gate was effectively "not-draft" rather than
 * "dao_finalized", defeating BR-011.
 */
const TS_ELIGIBLE_STATUSES = new Set(["dao_finalized", "ts_eligible"]);
export function canEnterTS(workStatus: string): { allowed: boolean; blockingReason?: string } {
  if (TS_ELIGIBLE_STATUSES.has(workStatus)) {
    return { allowed: true };
  }
  return { allowed: false, blockingReason: "DAO finalization is required before TS entry (BR-011)" };
}

/**
 * GAP2-WORKS-APPROVALS-01 / GAP2-WORKS-TENDERS-04: maker-checker (two-person
 * rule). The actor finalizing an approval/award must NOT be the actor who
 * created it (nor, for a second-level DO finalization, the actor who performed
 * the prior DAO finalization). A record carries createdBy; a prior finalizer
 * id may also be passed. Returns false → the caller rejects with 422
 * SELF_APPROVAL_FORBIDDEN.
 */
export function isSelfApproval(
  finalizerId: string,
  record: { createdBy?: string | null },
  priorFinalizerId?: string | null,
): boolean {
  if (record.createdBy && record.createdBy === finalizerId) return true;
  if (priorFinalizerId && priorFinalizerId === finalizerId) return true;
  return false;
}
