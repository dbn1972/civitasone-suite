import { canRaiseForApproval, isTerminalStatus, normStatus, type StatusRule } from "../statusActions";

/**
 * Contract status rules (UX-R5 / DS-3), mirroring contract-service contracts/domain.ts VALID_TRANSITIONS:
 *   draft -> pending_approval | approved | terminated;  pending_approval -> approved | terminated | draft;
 *   approved -> active | terminated;  active -> closed | terminated;  closed, terminated: final.
 * submit-approval (the eOffice raise) is draft -> pending_approval only. Milestones refuse a closed/terminated
 * contract server-side (409 CONTRACT_CLOSED); bonds are registered on approved/active contracts only.
 */
export const CONTRACT_STATUS_RULE: StatusRule = {
  terminal: ["closed", "terminated"],
  raisable: ["draft"],
  awaiting: ["pending_approval"],
};

export type ContractRecordAction =
  | "raiseForApproval"
  | "completeMilestone"
  | "markMilestoneLate"
  | "addObligation"
  | "updateObligation"
  | "registerBond";

export function contractAllowedActions(status: string | null | undefined): Set<ContractRecordAction> {
  const s = normStatus(status);
  const out = new Set<ContractRecordAction>();
  if (!s || isTerminalStatus(CONTRACT_STATUS_RULE, s)) return out;
  out.add("completeMilestone");
  out.add("markMilestoneLate");
  out.add("addObligation");
  out.add("updateObligation");
  if (s === "approved" || s === "active") out.add("registerBond");
  if (canRaiseForApproval(CONTRACT_STATUS_RULE, s)) out.add("raiseForApproval");
  return out;
}

/** Why milestone / obligation work is closed on this contract, or null when it is open. */
export function contractLockedReason(status: string | null | undefined): string | null {
  const s = normStatus(status);
  if (s === "terminated") return "This contract is terminated. Milestones and obligations can no longer be changed.";
  if (s === "closed") return "This contract is closed. Milestones and obligations can no longer be changed.";
  return null;
}
