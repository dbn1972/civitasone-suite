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
