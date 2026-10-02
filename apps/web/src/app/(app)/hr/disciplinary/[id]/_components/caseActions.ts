/**
 * GAP-HR-DISCIPLINARY-DETAIL-06: which state-machine transitions the case
 * page may offer, mirroring services/hrms-service's disciplinary
 * state-machine.ts TRANSITIONS table and the per-route role guards in
 * disciplinary/routes.ts. Pure and import-free so a parity test in the
 * hrms-service package can pin it against the real state machine (any drift
 * fails CI) -- the backend stays the authority; this only decides which
 * buttons are worth showing.
 *
 * Deliberately NOT offered: `submit_for_approval` (the eOffice
 * <RaiseEOfficeNote> on the same page is its entry point), and
 * `impose_penalty` from `pending_approval` (that transition belongs to the
 * eOffice decision consumer; a manual impose would bypass the approval the
 * case was just sent for).
 */

export type CaseActionKey =
  | "charge_memo"
  | "inquiry"
  | "finding"
  | "penalty"
  | "appeal"
  | "appeal_decision"
  | "close"
  | "drop";

export type ProceedingType = "minor" | "major";

/** Roles of the backend's own HR_ROLES / VIGILANCE_ROLES (disciplinary/routes.ts). */
export const HR_ONLY_ROLES = ["hr_admin", "super_admin"] as const;
export const VIGILANCE_ROLES = ["hr_admin", "super_admin", "hr_officer"] as const;

/** Per action: the backend route's required role tier. */
export const ACTION_ROLES: Record<CaseActionKey, readonly string[]> = {
  charge_memo: VIGILANCE_ROLES,
  inquiry: VIGILANCE_ROLES,
  finding: VIGILANCE_ROLES,
  penalty: HR_ONLY_ROLES,
  appeal: VIGILANCE_ROLES,
  appeal_decision: HR_ONLY_ROLES,
  close: HR_ONLY_ROLES,
  drop: HR_ONLY_ROLES,
};

/** Backend route path suffix under /v1/hrms/disciplinary-cases/:caseId/. */
export const ACTION_PATH: Record<CaseActionKey, string> = {
  charge_memo: "charge-memo",
  inquiry: "inquiry",
  finding: "finding",
  penalty: "penalty",
  appeal: "appeal",
  appeal_decision: "appeal-decision",
  close: "close",
  drop: "drop",
};

export const MINOR_PENALTIES = [
  "censure",
  "withholding_promotion",
  "recovery_from_pay",
  "withholding_increment",
  "reduction_to_lower_stage_minor",
] as const;

export const MAJOR_PENALTIES = [
  "reduction_to_lower_stage",
  "reduction_to_lower_rank",
  "compulsory_retirement",
  "removal_from_service",
  "dismissal",
] as const;

/** A major penalty cannot be imposed in a minor proceeding (backend 409 PENALTY_MISMATCH). */
export function penaltyOptionsFor(proceedingType: ProceedingType): readonly string[] {
  return proceedingType === "minor" ? MINOR_PENALTIES : [...MINOR_PENALTIES, ...MAJOR_PENALTIES];
}

export function normalizeProceeding(raw: string): ProceedingType | null {
  return raw === "minor" || raw === "major" ? raw : null;
}

/** Transitions the state machine allows from `status` (see header comment for exclusions). */
export function availableActions(status: string, proceedingType: ProceedingType): CaseActionKey[] {
  switch (status) {
    case "opened":
      return ["charge_memo", "drop"];
    case "charge_memo_issued":
      return proceedingType === "major" ? ["inquiry", "drop"] : ["penalty", "drop"];
    case "inquiry_appointed":
      return ["finding", "drop"];
    case "finding_recorded":
      return ["penalty", "drop"];
    case "pending_approval":
      return ["drop"];
    case "penalty_imposed":
      return ["appeal", "close"];
    case "appeal_filed":
      return ["appeal_decision"];
    case "appeal_decided":
      return ["close"];
    default:
      return [];
  }
}

/** Actions this session may actually trigger: right role tier AND the case's creator/inquiry officer. */
export function actionsForActor(
  status: string,
  proceedingType: ProceedingType,
  roles: readonly string[],
  isCaseOwner: boolean,
): CaseActionKey[] {
  if (!isCaseOwner) return [];
  return availableActions(status, proceedingType).filter((a) => ACTION_ROLES[a].some((r) => roles.includes(r)));
}

/** Mirrors the backend's assertCaseOwner: the case's creator or its assigned inquiry officer (actor-id space). */
export function isCaseOwner(
  userId: string | null,
  c: { createdBy: string; inquiryOfficerId: string | null },
): boolean {
  if (!userId) return false;
  return userId === c.createdBy || (c.inquiryOfficerId !== null && userId === c.inquiryOfficerId);
}
