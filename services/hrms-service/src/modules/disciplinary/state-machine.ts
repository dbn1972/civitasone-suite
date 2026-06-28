/**
 * Disciplinary case state machine (CCS (CCA) Rules flow). Pure logic.
 *
 * States:
 *   opened              case registered with an allegation
 *   charge_memo_issued  articles of charge / charge memo served
 *   inquiry_appointed   inquiry officer (and presenting officer) appointed
 *   finding_recorded    inquiry report / finding recorded (guilty / not / partly)
 *   pending_approval    proposed penalty submitted to eOffice for approval
 *   penalty_imposed     disciplinary authority imposes a minor/major penalty
 *   appeal_filed        the employee files a statutory appeal
 *   appeal_decided      appellate authority decides (upheld/modified/set_aside)
 *   closed              proceedings concluded
 *   dropped             dropped / exonerated at any stage
 *
 * Minor-penalty proceedings (CCA Rule 16) need not have a full oral inquiry, so
 * a 'minor' case may go opened -> charge_memo_issued -> penalty_imposed. Major
 * penalties (Rule 14) require the inquiry path.
 *
 * eOffice loop: a proposed penalty may be routed for formal approval —
 * submit_for_approval moves the case to pending_approval; the eOffice decision
 * then either imposes the penalty (approved) or drops the case (rejected). See
 * modules/disciplinary/eoffice-consumer.ts.
 */

export type CaseStatus =
  | "opened" | "charge_memo_issued" | "inquiry_appointed" | "finding_recorded"
  | "pending_approval" | "penalty_imposed" | "appeal_filed" | "appeal_decided"
  | "closed" | "dropped";

export type CaseAction =
  | "issue_charge_memo" | "appoint_inquiry" | "record_finding" | "submit_for_approval"
  | "impose_penalty" | "file_appeal" | "decide_appeal" | "close" | "drop";

interface Transition {
  from: CaseStatus;
  to: CaseStatus;
  /** When set, the proceeding_type must match for the transition to be allowed. */
  requiresProceeding?: "minor" | "major";
}

const TRANSITIONS: Readonly<Record<CaseAction, Transition[]>> = Object.freeze({
  issue_charge_memo: [{ from: "opened", to: "charge_memo_issued" }],
  appoint_inquiry: [{ from: "charge_memo_issued", to: "inquiry_appointed", requiresProceeding: "major" }],
  record_finding: [{ from: "inquiry_appointed", to: "finding_recorded" }],
  submit_for_approval: [
    // major: a recorded finding precedes the proposed penalty
    { from: "finding_recorded", to: "pending_approval" },
    // minor: a full inquiry is not mandatory, propose straight after charge memo
    { from: "charge_memo_issued", to: "pending_approval", requiresProceeding: "minor" },
  ],
  impose_penalty: [
    // major: after a recorded finding
    { from: "finding_recorded", to: "penalty_imposed" },
    // minor: a full inquiry is not mandatory, penalty straight after charge memo
    { from: "charge_memo_issued", to: "penalty_imposed", requiresProceeding: "minor" },
    // eOffice-approved penalty: applied from the pending_approval holding state
    { from: "pending_approval", to: "penalty_imposed" },
  ],
  file_appeal: [{ from: "penalty_imposed", to: "appeal_filed" }],
  decide_appeal: [{ from: "appeal_filed", to: "appeal_decided" }],
  close: [
    { from: "penalty_imposed", to: "closed" },
    { from: "appeal_decided", to: "closed" },
  ],
  drop: [
    { from: "opened", to: "dropped" },
    { from: "charge_memo_issued", to: "dropped" },
    { from: "inquiry_appointed", to: "dropped" },
    { from: "finding_recorded", to: "dropped" },
    // eOffice-rejected proposed penalty: case is dropped (closed, no action)
    { from: "pending_approval", to: "dropped" },
  ],
});

export interface TransitionCheck {
  ok: boolean;
  to?: CaseStatus;
  reason?: string;
}

/** Validate an action against the current status and proceeding type. */
export function canTransition(
  current: CaseStatus, action: CaseAction, proceedingType: "minor" | "major",
): TransitionCheck {
  const candidates = TRANSITIONS[action];
  for (const t of candidates) {
    if (t.from !== current) continue;
    if (t.requiresProceeding && t.requiresProceeding !== proceedingType) {
      return { ok: false, reason: `action '${action}' requires a ${t.requiresProceeding} proceeding (case is ${proceedingType})` };
    }
    return { ok: true, to: t.to };
  }
  const froms = candidates.map((c) => c.from).join(", ");
  return { ok: false, reason: `action '${action}' not allowed from '${current}' (allowed from: ${froms || "none"})` };
}

export const MINOR_PENALTIES: ReadonlySet<string> = new Set([
  "censure",
  "withholding_promotion",
  "recovery_from_pay",
  "withholding_increment",
  "reduction_to_lower_stage_minor",
]);

export const MAJOR_PENALTIES: ReadonlySet<string> = new Set([
  "reduction_to_lower_stage",
  "reduction_to_lower_rank",
  "compulsory_retirement",
  "removal_from_service",
  "dismissal",
]);

/** Returns 'minor' | 'major' for a penalty type, or null if unknown. */
export function penaltyClassOf(penaltyType: string): "minor" | "major" | null {
  if (MINOR_PENALTIES.has(penaltyType)) return "minor";
  if (MAJOR_PENALTIES.has(penaltyType)) return "major";
  return null;
}
