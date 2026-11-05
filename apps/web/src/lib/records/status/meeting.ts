import { isAwaitingDecision, isTerminalStatus, normStatus, type StatusRule } from "../statusActions";

/**
 * Meeting minutes status rules (UX-R5 / DS-3), mirroring the meeting service minutes workflow:
 *   draft -> submitted (secretary, maker) -> approved (chairperson, checker; or returned to draft)
 *   -> signed -> circulated. Approved, signed and circulated minutes are sealed (integrity hash chain).
 */
export const MINUTES_STATUS_RULE: StatusRule = {
  terminal: ["approved", "signed", "circulated"],
  awaiting: ["submitted"],
  raisable: ["draft"],
};

export type MinutesAction = "edit" | "submit" | "approve" | "return";

/** What the minutes status allows (role and maker-checker checks are applied on top by the panel). */
export function minutesAllowedActions(status: string | null | undefined): Set<MinutesAction> {
  const s = normStatus(status);
  if (s === "draft") return new Set(["edit", "submit"]);
  if (isAwaitingDecision(MINUTES_STATUS_RULE, s)) return new Set(["approve", "return"]);
  return new Set();
}

export function minutesAreSealed(status: string | null | undefined): boolean {
  return isTerminalStatus(MINUTES_STATUS_RULE, status);
}
