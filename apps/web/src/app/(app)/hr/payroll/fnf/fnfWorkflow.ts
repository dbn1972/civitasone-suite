/**
 * GAP-PAYROLL-FNF-01: client-side mirror of payroll-service's
 * src/modules/fnf/workflow.ts, used ONLY to decide which buttons to show.
 * The server re-checks every rule (and the consumer re-checks them again
 * under a row lock), so a drift here can hide/show a button but can never
 * let a forbidden transition through. Keep in sync with workflow.ts.
 *
 * Pure module: no server-only imports (it is used by a client component).
 */

export type FnfAction = "submit" | "finance-approve" | "disburse" | "reject";

export type FnfViewer = { userId: string | null; roles: readonly string[] };

export type FnfWorkflowFields = {
  status: string;
  version?: number | null;
  computedBy?: string | null;
  submittedBy?: string | null;
  financeApprovedBy?: string | null;
};

export const FNF_SUBMIT_ROLES = ["payroll_admin", "payroll_officer"];
export const FNF_FINANCE_APPROVE_ROLES = ["finance_officer", "payroll_admin"];
export const FNF_DISBURSE_ROLES = ["payroll_admin", "super_admin"];
/** Roles that may COMPUTE (payroll-service FNF_ROLES). */
export const FNF_COMPUTE_ROLES = ["payroll_admin", "hr_admin", "super_admin", "finance_officer"];
/** Roles that may READ the list (FNF_ROLES + payroll_officer, who submits). */
export const FNF_READ_ROLES = [...FNF_COMPUTE_ROLES, "payroll_officer"];

/** Server-side reference-format rule (fnf/routes.ts disburse body). */
export const PAYMENT_REFERENCE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9/-]{3,63}$/;
export const REJECT_REASON_MIN = 10;
export const REASON_MAX = 512;

const has = (viewer: FnfViewer, roles: string[]) => roles.some((r) => viewer.roles.includes(r));

export type FnfAvailability = {
  /** Actions this viewer may take now, in display order. */
  actions: FnfAction[];
  /** True when the viewer holds the role for the next step but is excluded by segregation of duties. */
  selfExcluded: boolean;
};

export function fnfAvailability(row: FnfWorkflowFields, viewer: FnfViewer): FnfAvailability {
  const none: FnfAvailability = { actions: [], selfExcluded: false };
  if (!viewer.userId || typeof row.version !== "number") return none;
  const me = viewer.userId;
  switch (row.status) {
    case "draft":
    case "computed":
      return { actions: has(viewer, FNF_SUBMIT_ROLES) ? ["submit"] : [], selfExcluded: false };
    case "submitted": {
      if (!has(viewer, FNF_FINANCE_APPROVE_ROLES)) return none;
      const self = me === row.submittedBy || me === row.computedBy;
      return self ? { actions: [], selfExcluded: true } : { actions: ["finance-approve", "reject"], selfExcluded: false };
    }
    case "finance_approved": {
      if (!has(viewer, FNF_DISBURSE_ROLES)) return none;
      // Releasing money takes three distinct people: whoever computed or
      // submitted it and whoever approved it can never also disburse it.
      const self = me === row.financeApprovedBy || me === row.submittedBy || me === row.computedBy;
      return self ? { actions: [], selfExcluded: true } : { actions: ["disburse", "reject"], selfExcluded: false };
    }
    default:
      return none;
  }
}

/** Today's date in IST as YYYY-MM-DD (the server refuses a future payment date in IST). */
export function todayIst(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}
