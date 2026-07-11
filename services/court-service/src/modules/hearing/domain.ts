/**
 * hearing pure domain — the hearing state machine and id derivation (§19/§20).
 * No I/O.
 */
import { deterministicId, COURT_NAMESPACE } from "../court-registry/domain.js";

export const HEARING_STATUSES = ["scheduled", "held", "adjourned", "cancelled"] as const;
export type HearingStatus = typeof HEARING_STATUSES[number];

/** A scheduled hearing can be held, adjourned (a fresh hearing is listed for the
 *  next date), or cancelled. Held/adjourned/cancelled are terminal for THIS row. */
const TRANSITIONS: Record<HearingStatus, HearingStatus[]> = {
  scheduled: ["held", "adjourned", "cancelled"],
  held:      [],
  adjourned: [],
  cancelled: [],
};

export function canTransition(from: HearingStatus, to: HearingStatus): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

export function assertTransition(from: string, to: HearingStatus): void {
  if (!canTransition(from as HearingStatus, to)) {
    throw new Error(`INVALID_HEARING_TRANSITION: cannot move hearing from '${from}' to '${to}'`);
  }
}

/** A hearing id is deterministic on (tenant + case + scheduled instant) so
 *  re-submitting the SAME hearing (same case + time) is idempotent end-to-end. */
export function deriveHearingId(tenantId: string, caseId: string, scheduledAtIso: string): string {
  return deterministicId(COURT_NAMESPACE, `${tenantId}:hearing:${caseId}:${scheduledAtIso}`);
}

/**
 * Default hearing purposes (§19) used as a FALLBACK when a tenant has not
 * configured its own `hearing_purpose` namespace in the config/metadata engine
 * (§47). The effective allowed set is (defaults ∪ tenant config keys), so an
 * admin can ADD a bespoke purpose via config with no code change. `purpose` is
 * OPTIONAL on a hearing — it is validated only when present.
 */
export const DEFAULT_HEARING_PURPOSES = [
  "arguments", "evidence", "first_hearing", "final_hearing", "admission",
  "miscellaneous", "settlement", "framing_of_issues", "pronouncement",
  "compliance", "mention",
] as const;

/** Throw INVALID_HEARING_PURPOSE unless `purpose` is in the effective allowed set. */
export function assertHearingPurposeAllowed(purpose: string, allowed: ReadonlySet<string>): void {
  if (!allowed.has(purpose)) {
    throw new Error(`INVALID_HEARING_PURPOSE: ${purpose} is not an allowed hearing purpose for this tenant`);
  }
}
