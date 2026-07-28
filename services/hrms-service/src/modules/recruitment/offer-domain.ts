/**
 * Selection & offer domain (pure). Compensation fitment (sum of components →
 * gross CTC), the offer approval chain (HR → finance → legal → competent
 * authority, R-RA-0158), structured decline reasons (R-RA-0163), and the offer
 * lifecycle state predicates. Reuses the approval-chain stage helpers from the
 * requisition domain. Money in paise (bigint). No I/O.
 */
import type { ApprovalStage } from "./requisition-domain.js";
export { currentStageRole, isFinalStage } from "./requisition-domain.js";
export type { ApprovalStage } from "./requisition-domain.js";

/** Default Government offer approval chain (R-RA-0158). */
export const DEFAULT_OFFER_CHAIN: ApprovalStage[] = [
  { stage: "HR", role: "hr_admin" },
  { stage: "Finance", role: "finance_officer" },
  { stage: "Legal", role: "legal_officer" },
  { stage: "Competent Authority", role: "competent_authority" },
];

/** R-RA-0163 structured offer-decline reasons. */
export const DECLINE_REASON_CODES = [
  "salary", "alternate_offer", "relocation", "personal", "joining_timeline", "other",
] as const;
export type DeclineReasonCode = (typeof DECLINE_REASON_CODES)[number];
export function isDeclineReasonCode(v: string): v is DeclineReasonCode {
  return (DECLINE_REASON_CODES as readonly string[]).includes(v);
}

export interface CompensationInput {
  basicMinor: bigint;
  joiningBonusMinor: bigint;
  relocationMinor: bigint;
  variablePayMinor: bigint;
}
export interface Compensation extends CompensationInput { grossCtcMinor: bigint; }

/** Fitment: gross CTC is the sum of the offered components (R-RA-0156). */
export function computeCompensation(i: CompensationInput): Compensation {
  return { ...i, grossCtcMinor: i.basicMinor + i.joiningBonusMinor + i.relocationMinor + i.variablePayMinor };
}

/** Only a fully-approved offer may be released to the candidate. */
export function canRelease(status: string): boolean {
  return status === "approved";
}
/** Terminal states — no further lifecycle action is possible. */
export function isTerminal(status: string): boolean {
  return ["accepted", "declined", "withdrawn", "expired", "revised"].includes(status);
}
/** An offer may be edited only while draft or returned. */
export function isOfferEditable(status: string): boolean {
  return status === "draft" || status === "returned";
}
