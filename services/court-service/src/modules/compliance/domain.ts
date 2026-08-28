/**
 * compliance pure domain — the compliance-direction state machine and id
 * derivation (§26 — execution / compliance monitoring of orders). No I/O.
 */
import { deterministicId, COURT_NAMESPACE } from "../court-registry/domain.js";

export const COMPLIANCE_STATUSES = [
  "pending",
  "in_progress",
  "completed",
  "verified",
  "non_compliant",
] as const;
export type ComplianceStatus = typeof COMPLIANCE_STATUSES[number];

/**
 * Compliance lifecycle (§26): a fresh direction is `pending`. Work begins
 * (`in_progress`) or it is flagged `non_compliant` outright. In-progress work is
 * either `completed` or found `non_compliant`. A completed direction is `verified`
 * by the court. `verified` and `non_compliant` are terminal.
 */
const TRANSITIONS: Record<ComplianceStatus, ComplianceStatus[]> = {
  pending:       ["in_progress", "non_compliant"],
  in_progress:   ["completed", "non_compliant"],
  completed:     ["verified"],
  verified:      [],
  non_compliant: [],
};

export function canTransition(from: ComplianceStatus, to: ComplianceStatus): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

export function assertTransition(from: string, to: ComplianceStatus): void {
  if (!canTransition(from as ComplianceStatus, to)) {
    throw new Error(`INVALID_COMPLIANCE_TRANSITION: cannot move direction from '${from}' to '${to}'`);
  }
}

/** `verified` and `non_compliant` close a direction — no further transitions. */
export function isTerminal(status: string): boolean {
  return status === "verified" || status === "non_compliant";
}

/**
 * A compliance-direction id is deterministic on (tenant + case + order + seq) so
 * re-submitting the SAME direction is idempotent end-to-end. `orderId` may be
 * absent (a direction not tied to a specific order); a stable empty marker keeps
 * the derivation total.
 *
 * `seq` is NOT a manually-incremented counter — the command layer (commands.ts)
 * computes it as a hash of the direction's meaningful content (direction text,
 * responsibleAuthority, dueDate, ...), so an identical resubmission (a genuine
 * retry) collapses to the same id while a genuinely different direction — even on
 * the same case/order — gets a distinct one. See directionContentSeq in
 * compliance/commands.ts.
 */
export function deriveDirectionId(
  tenantId: string, caseId: string, orderId: string | undefined, seq: number,
): string {
  return deterministicId(
    COURT_NAMESPACE,
    `${tenantId}:compliance:${caseId}:${orderId ?? "-"}:${seq}`,
  );
}
