/**
 * Recruitment requisition approval-chain state machine (pure). The requisition
 * routes through an ordered chain of mandatory approver stages (e.g. hiring
 * manager → HR → finance → competent authority). Each stage must approve, in
 * order, before the requisition is fully approved and eligible for publication.
 */

export interface ApprovalStage {
  stage: string; // human label, e.g. "Hiring Manager"
  role: string;  // the role permitted to act at this stage, e.g. "hiring_manager"
}

/** Default Government approval chain (R-RA-0053). */
export const DEFAULT_GOVT_CHAIN: ApprovalStage[] = [
  { stage: "Hiring Manager", role: "hiring_manager" },
  { stage: "HR", role: "hr_admin" },
  { stage: "Finance", role: "finance_officer" },
  { stage: "Competent Authority", role: "competent_authority" },
];

/** The role permitted to act at the requisition's current stage, or null. */
export function currentStageRole(chain: ApprovalStage[], currentStage: number): string | null {
  if (currentStage < 0 || currentStage >= chain.length) return null;
  return chain[currentStage]!.role;
}

/** After an approve at `currentStage`, is the whole chain now complete? */
export function isFinalStage(chain: ApprovalStage[], currentStage: number): boolean {
  return currentStage >= 0 && currentStage === chain.length - 1;
}

/** Only a fully-approved requisition may be published as a job opening (R-RA-0056). */
export function canPublish(status: string): boolean {
  return status === "approved";
}

/** A requisition can be edited only while it is a draft or has been returned. */
export function isEditable(status: string): boolean {
  return status === "draft" || status === "returned";
}

/**
 * Fields carried over when cloning a requisition (R-RA-0059): the hiring
 * specification is copied, but obsolete dates, approvals, status, publication
 * linkage and the requisition number are NOT — the clone starts as a fresh draft.
 */
export const CLONE_CARRY_FIELDS = [
  "title", "positionId", "reason", "employmentType", "recruitmentMode", "campaignType",
  "departmentId", "designationId", "grade", "location", "vacancies", "experienceMinYears",
  "qualification", "skills", "reservation", "budgetMinor", "confidential", "agencyId",
  "slaDays", "approvalChain",
] as const;

/**
 * Map a requisition's recruitment mode / campaign type to a valid
 * hrms_job_openings.vacancy_type value at publication. The job-openings table
 * constrains vacancy_type to {regular, internship, apprenticeship, contractual,
 * deputation}; the requisition's employment_type (permanent/…) is a DIFFERENT
 * domain and must not be written there directly. Pure.
 */
export function toVacancyType(recruitmentMode: string, campaignType: string): string {
  if (recruitmentMode === "deputation") return "deputation";
  if (recruitmentMode === "contract" || recruitmentMode === "consultant") return "contractual";
  if (campaignType === "apprenticeship") return "apprenticeship";
  return "regular";
}

export function cloneFields(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of CLONE_CARRY_FIELDS) {
    if (row[f] !== undefined && row[f] !== null) out[f] = row[f];
  }
  return out;
}
