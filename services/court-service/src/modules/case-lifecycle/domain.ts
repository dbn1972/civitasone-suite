/**
 * case-lifecycle pure domain — the state machine is owned by case-registry and
 * re-exported here so both the registration and transition paths share ONE
 * source of truth for legal transitions (no divergence).
 */
export {
  CASE_STATUSES,
  type CaseStatus,
  canTransition,
  assertTransition,
} from "../case-registry/domain.js";

import type { CaseStatus } from "../case-registry/domain.js";

/** Terminal states have no onward transition except appeal (disposed) / none. */
export function isTerminal(status: CaseStatus): boolean {
  return status === "disposed" || status === "appealed";
}

/** For now `stage` mirrors `status`; a richer sub-stage model is config-driven (§47). */
export function deriveStage(status: CaseStatus): string {
  return status;
}
