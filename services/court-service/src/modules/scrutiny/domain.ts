/**
 * scrutiny pure domain — the registry-scrutiny + defect state machines and id
 * derivation (§13). No I/O — every function here is deterministic and side-effect
 * free so it is trivially unit-testable and safe to call from both the command and
 * consumer paths.
 */
import { deterministicId, COURT_NAMESPACE } from "../court-registry/domain.js";

// ─── Scrutiny state machine ────────────────────────────────────────────────────

export const SCRUTINY_STATUSES = ["pending", "cleared", "defective"] as const;
export type ScrutinyStatus = typeof SCRUTINY_STATUSES[number];

/** A pending scrutiny can be cleared or marked defective; a defective scrutiny is
 *  cleared once its raised defects are rectified/waived. cleared is terminal. */
const SCRUTINY_TRANSITIONS: Record<ScrutinyStatus, ScrutinyStatus[]> = {
  pending:   ["cleared", "defective"],
  defective: ["cleared"],
  cleared:   [],
};

export function canScrutinyTransition(from: ScrutinyStatus, to: ScrutinyStatus): boolean {
  return SCRUTINY_TRANSITIONS[from]?.includes(to) ?? false;
}

export function assertScrutinyTransition(from: string, to: ScrutinyStatus): void {
  if (!canScrutinyTransition(from as ScrutinyStatus, to)) {
    throw new Error(`INVALID_SCRUTINY_TRANSITION: cannot move scrutiny from '${from}' to '${to}'`);
  }
}

// ─── Defect state machine ──────────────────────────────────────────────────────

export const DEFECT_STATUSES = ["raised", "rectified", "waived", "rejected"] as const;
export type DefectStatus = typeof DEFECT_STATUSES[number];

/** A raised defect is resolved by being rectified, waived, or rejected. All three
 *  resolutions are terminal for the defect. */
const DEFECT_TRANSITIONS: Record<DefectStatus, DefectStatus[]> = {
  raised:    ["rectified", "waived", "rejected"],
  rectified: [],
  waived:    [],
  rejected:  [],
};

export function canDefectTransition(from: DefectStatus, to: DefectStatus): boolean {
  return DEFECT_TRANSITIONS[from]?.includes(to) ?? false;
}

export function assertDefectTransition(from: string, to: DefectStatus): void {
  if (!canDefectTransition(from as DefectStatus, to)) {
    throw new Error(`INVALID_DEFECT_TRANSITION: cannot move defect from '${from}' to '${to}'`);
  }
}

// ─── Id derivation (idempotency) ───────────────────────────────────────────────

/** A case has exactly ONE scrutiny record, so the id is deterministic on
 *  (tenant + case) — re-submitting the scrutiny for the same case is idempotent. */
export function deriveScrutinyId(tenantId: string, caseId: string): string {
  return deterministicId(COURT_NAMESPACE, `${tenantId}:scrutiny:${caseId}`);
}

/** A defect id is deterministic on (tenant + case + category + seq) so re-raising
 *  the SAME defect (same case + category + sequence) is idempotent end-to-end. */
export function deriveDefectId(tenantId: string, caseId: string, category: string, seq: number): string {
  return deterministicId(COURT_NAMESPACE, `${tenantId}:defect:${caseId}:${category.trim().toLowerCase()}:${seq}`);
}
