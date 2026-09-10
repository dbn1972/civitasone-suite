/**
 * hearing pure domain — the hearing state machine and id derivation (§19/§20).
 * No I/O.
 */
import { deterministicId, COURT_NAMESPACE } from "../court-registry/domain.js";
import { isTerminal, type CaseStatus } from "../case-lifecycle/domain.js";

export const HEARING_STATUSES = ["scheduled", "held", "adjourned", "cancelled"] as const;
export type HearingStatus = typeof HEARING_STATUSES[number];

/** A scheduled hearing can be held, adjourned, or cancelled. Held/adjourned/
 *  cancelled are all TERMINAL for this row -- adjourning does NOT create a new
 *  hearing row for the next date (there is no insertHearing call anywhere in
 *  the adjourn path; confirmed live during the deep-verification pass that
 *  produced this fix). A human must separately schedule the follow-up hearing;
 *  see HearingsConsole.tsx's adjourn dialog, which used to claim otherwise. */
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
 * (§47). The effective allowed set is the tenant’s configured `hearing_purpose`
 * values when any exist (AUTHORITATIVE — it REPLACES these defaults), else
 * these module defaults; the tenant’s list fully overrides the fallback and may
 * add bespoke purposes with no code change. `purpose` is OPTIONAL on a hearing —
 * it is validated only when present.
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

/**
 * DOM-003 (hearing-side) — mirrors order/domain.ts's assertCaseOpenForOrder:
 * a case in a terminal status (disposed/appealed -- see case-lifecycle/domain.ts's
 * isTerminal, the same single source of truth the order-side fix (#1119) uses)
 * can never have a hearing scheduled against it, nor an existing hearing on it
 * adjourned or have its outcome recorded -- all three are live judicial acts
 * against a case that's already closed. Reject explicitly (CASE_TERMINAL)
 * rather than silently accepting it.
 *
 * Unlike an order (which cites a hearingId by cross-reference and so needs a
 * separate "does this hearing belong to this case" ownership check -- see
 * assertHearingUsableForOrder), a hearing IS the case-scoped row: its caseId
 * comes either directly off the client payload at schedule time (never a
 * second, independently-suppliable id) or, for adjourn/record-outcome, off
 * the hearing row itself as read from the DB (hearingRepo.getHearingForUpdate),
 * never from anything the client asserts. There is no cross-reference to
 * mismatch, so no separate ownership guard is needed here.
 */
export function assertCaseOpenForHearing(caseId: string, status: string): void {
  if (isTerminal(status as CaseStatus)) {
    throw new Error(
      `CASE_TERMINAL: cannot schedule, adjourn, or record an outcome for a hearing against case ${caseId} in terminal status '${status}'`,
    );
  }
}
