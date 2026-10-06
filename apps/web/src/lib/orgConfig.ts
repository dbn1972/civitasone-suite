/**
 * Organisation Type Configuration — makes CivitasOne adaptable to any sector.
 *
 * Each org type defines:
 * - Terminology: what things are called (office/company/institution, DDO/CFO, etc.)
 * - Default policies: what rules apply by default
 * - Feature visibility: which govt-specific features to hide
 *
 * The active config is resolved from the tenant's settings.orgType at render time.
 */

export const ORG_TYPES = [
  "govt_dept",           // Central/State government department
  "govt_autonomous",     // Autonomous body under govt
  "psu",                 // Public Sector Undertaking
  "private",             // Private company
  "ngo",                 // NGO / Trust / Society
  "cooperative",         // Cooperative society
  "municipal",           // Municipal/local body
  "educational",         // University / College / School
] as const;

export type OrgType = (typeof ORG_TYPES)[number];

export type OrgTerminology = {
  /** What we call the organisation (e.g. "office", "company", "institution") */
  orgUnit: string;
  /** What we call a branch (e.g. "branch office", "branch", "campus") */
  branch: string;
  /** What the head person is called (e.g. "Head of Office", "CEO", "Director") */
  orgHead: string;
  /** What we call the finance authority (e.g. "DDO", "CFO", "Finance Manager") */
  financeHead: string;
  /** What we call the performance review (e.g. "APAR", "Performance Review", "Appraisal") */
  performanceReview: string;
  /** What we call salary (e.g. "Pay", "Salary", "CTC", "Compensation") */
  salary: string;
  /** What we call the approval workflow (e.g. "Send for approval", "Submit for approval") */
  approval: string;
  /** Whether to show govt-specific terms (Sanction, UC, GRN tooltip) or generic */
  govtTerms: boolean;
  /** Whether 7th CPC pay matrix is relevant */
  cpcPayMatrix: boolean;
  /** Whether CCS leave rules (sandwich, prefix-suffix) apply */
  ccsLeaveRules: boolean;
};

const TERMINOLOGY: Record<OrgType, OrgTerminology> = {
  govt_dept: {
    orgUnit: "office", branch: "branch office", orgHead: "Head of Office",
    financeHead: "DDO", performanceReview: "APAR", salary: "Pay",
    approval: "Send for approval", govtTerms: true, cpcPayMatrix: true, ccsLeaveRules: true,
  },
  govt_autonomous: {
    orgUnit: "organisation", branch: "regional office", orgHead: "Director",
    financeHead: "Finance Controller", performanceReview: "Performance Appraisal", salary: "Pay",
    approval: "Submit for approval", govtTerms: true, cpcPayMatrix: true, ccsLeaveRules: true,
  },
  psu: {
    orgUnit: "company", branch: "unit", orgHead: "CMD / MD",
    financeHead: "CFO", performanceReview: "Performance Review", salary: "CTC",
    approval: "Submit for approval", govtTerms: false, cpcPayMatrix: false, ccsLeaveRules: false,
  },
  private: {
    orgUnit: "company", branch: "branch", orgHead: "CEO",
    financeHead: "CFO", performanceReview: "Performance Review", salary: "CTC",
    approval: "Submit for approval", govtTerms: false, cpcPayMatrix: false, ccsLeaveRules: false,
  },
  ngo: {
    orgUnit: "organisation", branch: "field office", orgHead: "Executive Director",
    financeHead: "Finance Manager", performanceReview: "Annual Review", salary: "Compensation",
    approval: "Submit for approval", govtTerms: false, cpcPayMatrix: false, ccsLeaveRules: false,
  },
  cooperative: {
    orgUnit: "society", branch: "branch", orgHead: "Chairman / Secretary",
    financeHead: "Treasurer", performanceReview: "Annual Review", salary: "Salary",
    approval: "Submit for approval", govtTerms: false, cpcPayMatrix: false, ccsLeaveRules: false,
  },
  municipal: {
    orgUnit: "corporation", branch: "ward office", orgHead: "Commissioner",
    financeHead: "CFO / AO", performanceReview: "APAR", salary: "Pay",
    approval: "Send for approval", govtTerms: true, cpcPayMatrix: true, ccsLeaveRules: true,
  },
  educational: {
    orgUnit: "institution", branch: "campus", orgHead: "Vice Chancellor / Principal",
    financeHead: "Finance Officer", performanceReview: "Academic Review", salary: "Pay",
    approval: "Submit for approval", govtTerms: false, cpcPayMatrix: true, ccsLeaveRules: false,
  },
};

/** Get the terminology config for an org type. Defaults to govt_dept. */
export function getTerminology(orgType?: string | null): OrgTerminology {
  if (orgType && orgType in TERMINOLOGY) return TERMINOLOGY[orgType as OrgType];
  return TERMINOLOGY.govt_dept;
}

/**
 * GAP-TENANT-ADMIN-ORG-TYPE-04: one-line explanation of what each terminology
 * flag actually switches on, so the Govt terms / CPC Pay / CCS Leave tags are
 * not unexplained jargon. Keyed by the OrgTerminology boolean field name.
 */
export const FLAG_HELP: Record<"govtTerms" | "cpcPayMatrix" | "ccsLeaveRules", { label: string; help: string }> = {
  govtTerms: {
    label: "Govt terms",
    help: "Uses government vocabulary (Sanction, Utilisation Certificate, GRN) instead of generic business terms.",
  },
  cpcPayMatrix: {
    label: "CPC Pay",
    help: "Pay is structured on the 7th Central Pay Commission matrix (levels and cells) rather than a free CTC.",
  },
  ccsLeaveRules: {
    label: "CCS Leave",
    help: "Applies CCS (Leave) Rules — sandwich leave and prefix/suffix holiday counting.",
  },
};

/** Display label for an org type. */
export const ORG_TYPE_LABELS: Record<OrgType, string> = {
  govt_dept: "Government Department",
  govt_autonomous: "Autonomous Body (Govt)",
  psu: "Public Sector Undertaking (PSU)",
  private: "Private Company",
  ngo: "NGO / Trust / Society",
  cooperative: "Cooperative Society",
  municipal: "Municipal / Local Body",
  educational: "University / Educational Institution",
};
