import { isAwaitingDecision, isTerminalStatus, normStatus, type StatusRule } from "../statusActions";

/**
 * Disciplinary case status rules (UX-R5 / DS-3), mirroring hrms-service disciplinary/state-machine.ts:
 *   submit_for_approval: finding_recorded -> pending_approval (any proceeding);
 *                        charge_memo_issued -> pending_approval (MINOR proceeding only).
 *   closed, dropped: final (no transition out of either).
 * The page per-action buttons come from hr/disciplinary/[id]/_components/caseActions.ts (availableActions);
 * this rule decides only whether the eOffice "Raise for approval" fits the case status.
 */
export const DISCIPLINARY_STATUS_RULE: StatusRule = {
  terminal: ["closed", "dropped"],
  awaiting: ["pending_approval"],
  raisable: ["finding_recorded", "charge_memo_issued"],
};

/** May this case be raised to eOffice for approval of the proposed penalty? */
export function disciplinaryCanRaise(status: string | null | undefined, proceedingType: string | null | undefined): boolean {
  const s = normStatus(status);
  if (s === "finding_recorded") return true;
  if (s === "charge_memo_issued") return normStatus(proceedingType) === "minor";
  return false;
}

export type DisciplinaryRaiseState = "raisable" | "awaiting" | "finished" | "not_yet";

/** Why the raise is (not) offered, for the reason line. */
export function disciplinaryRaiseState(status: string | null | undefined, proceedingType: string | null | undefined): DisciplinaryRaiseState {
  if (disciplinaryCanRaise(status, proceedingType)) return "raisable";
  if (isAwaitingDecision(DISCIPLINARY_STATUS_RULE, status)) return "awaiting";
  if (isTerminalStatus(DISCIPLINARY_STATUS_RULE, status)) return "finished";
  return "not_yet";
}
