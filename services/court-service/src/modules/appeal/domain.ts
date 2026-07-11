/**
 * appeal pure domain — the appeal state machine and id derivation (§25).
 * No I/O — every function here is deterministic and side-effect free so it is
 * trivially unit-testable and safe to call from both the command and consumer
 * paths.
 */
import { deterministicId, COURT_NAMESPACE } from "../court-registry/domain.js";

export const APPEAL_STATUSES = [
  "filed",
  "registered",
  "allowed",
  "dismissed",
  "remanded",
  "modified",
  "withdrawn",
] as const;
export type AppealStatus = typeof APPEAL_STATUSES[number];

/**
 * Appeal lifecycle (§25): a filed appeal is registered, then decided
 * (allowed | dismissed | remanded | modified) or withdrawn. A filed appeal may
 * also be withdrawn before registration. The decision + withdrawn states are
 * terminal (no onward transition).
 */
const TRANSITIONS: Record<AppealStatus, AppealStatus[]> = {
  filed:      ["registered", "withdrawn"],
  registered: ["allowed", "dismissed", "remanded", "modified", "withdrawn"],
  allowed:    [],
  dismissed:  [],
  remanded:   [],
  modified:   [],
  withdrawn:  [],
};

export function canTransition(from: AppealStatus, to: AppealStatus): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

export function assertTransition(from: string, to: AppealStatus): void {
  if (!canTransition(from as AppealStatus, to)) {
    throw new Error(`INVALID_APPEAL_TRANSITION: cannot move appeal from '${from}' to '${to}'`);
  }
}

/** Terminal states carry no onward transition (decided or withdrawn). */
export function isTerminal(status: AppealStatus): boolean {
  return (
    status === "allowed" ||
    status === "dismissed" ||
    status === "remanded" ||
    status === "modified" ||
    status === "withdrawn"
  );
}

/**
 * An appeal id is deterministic on (tenant + original case + appeal type + filed
 * date) so re-submitting the SAME appeal is idempotent end-to-end.
 */
export function deriveAppealId(
  tenantId: string,
  originalCaseId: string,
  appealType: string,
  filedDateIso: string,
): string {
  return deterministicId(
    COURT_NAMESPACE,
    `${tenantId}:appeal:${originalCaseId}:${appealType}:${filedDateIso}`,
  );
}
