/**
 * GAP-PAYROLL-FNF-01: F&F settlement approval / payment workflow.
 *
 * Pure rules shared by the routes (synchronous 403/409 for the caller) and
 * the consumer (re-asserted under a row lock so a replayed, racing or stale
 * command can never double-transition or bypass maker-checker).
 *
 *   draft | computed --submit--> submitted --finance-approve--> finance_approved
 *   finance_approved --disburse--> disbursed                       (terminal)
 *   submitted | finance_approved --reject--> rejected
 *   rejected --recompute (POST /v1/payroll/fnf/compute)--> computed
 *
 * 'rejected' sends the settlement back to the payroll desk: it can't be
 * resubmitted as-is, only recomputed (fnf/consumer.ts), which resets it to
 * 'computed' and restarts the chain. 'draft' is the status the compute
 * consumer wrote before this workflow existed -- those rows are fully
 * computed, so they are submittable exactly like 'computed'.
 *
 * Maker-checker (SAFE DEFAULT -- pending product confirmation):
 *   submit           payroll_admin | payroll_officer
 *   finance-approve  finance_officer | payroll_admin; never the submitter,
 *                    never whoever computed the settlement
 *   disburse         payroll_admin | super_admin; never the finance approver,
 *                    the submitter or the computer -- releasing money always
 *                    takes three distinct people (computer/submitter,
 *                    approver, disburser), and submit != disburse
 *   reject           whoever may take the NEXT forward step from the current
 *                    status (finance-approve rules from 'submitted', disburse
 *                    rules from 'finance_approved'); reason >= 10 chars
 *
 * Disburse records a payment the user made outside this system (payment
 * reference + date they enter). It does NOT move money or generate a bank
 * file -- see the PR description.
 */

export const FNF_ACTIONS = ["submit", "finance-approve", "disburse", "reject"] as const;
export type FnfAction = (typeof FNF_ACTIONS)[number];

export const FNF_SUBMIT_ROLES = ["payroll_admin", "payroll_officer"];
export const FNF_FINANCE_APPROVE_ROLES = ["finance_officer", "payroll_admin"];
export const FNF_DISBURSE_ROLES = ["payroll_admin", "super_admin"];
/** Anyone who could possibly reject (the per-status rule is narrower). */
export const FNF_REJECT_ROLES = [...new Set([...FNF_FINANCE_APPROVE_ROLES, ...FNF_DISBURSE_ROLES])];

export const FNF_SUBMITTABLE_STATUSES = ["draft", "computed"] as const;
export const FNF_REJECTABLE_STATUSES = ["submitted", "finance_approved"] as const;

/** The columns the rules need, in camelCase (route reads via drizzle, consumer via raw SQL -- both map to this). */
export type FnfWorkflowRow = {
  status: string;
  version: number;
  createdBy: string;
  computedBy: string | null;
  submittedBy: string | null;
  financeApprovedBy: string | null;
};

export type FnfDenial = { status: 403 | 409; code: string; message: string };
export type FnfDecision =
  | { ok: true; from: string; to: string }
  | ({ ok: false } & FnfDenial);

const TARGET: Record<FnfAction, string> = {
  submit: "submitted",
  "finance-approve": "finance_approved",
  disburse: "disbursed",
  reject: "rejected",
};

export function targetStatus(action: FnfAction): string {
  return TARGET[action];
}

/** Statuses `action` may start from. */
export function allowedFrom(action: FnfAction): readonly string[] {
  switch (action) {
    case "submit": return FNF_SUBMITTABLE_STATUSES;
    case "finance-approve": return ["submitted"];
    case "disburse": return ["finance_approved"];
    case "reject": return FNF_REJECTABLE_STATUSES;
  }
}

/** Roles allowed to take `action` from `fromStatus`. */
export function rolesFor(action: FnfAction, fromStatus: string): string[] {
  switch (action) {
    case "submit": return FNF_SUBMIT_ROLES;
    case "finance-approve": return FNF_FINANCE_APPROVE_ROLES;
    case "disburse": return FNF_DISBURSE_ROLES;
    case "reject": return fromStatus === "finance_approved" ? FNF_DISBURSE_ROLES : FNF_FINANCE_APPROVE_ROLES;
  }
}

/** Who computed the settlement: computed_by (0052+), else the row's creator. */
export function computerOf(row: FnfWorkflowRow): string {
  return row.computedBy ?? row.createdBy;
}

/**
 * Decide whether `actor` may take `action` on `row`.
 *
 * `actor.roles` is optional: the route passes the caller's roles; the
 * consumer omits them (the route already enforced them, and the command
 * message does not carry roles) and re-checks everything else.
 * `expectedVersion` is the version the caller saw; a mismatch means someone
 * else moved the row first (optimistic concurrency).
 */
export function decideTransition(
  action: FnfAction,
  row: FnfWorkflowRow,
  actor: { id: string; roles?: readonly string[] },
  expectedVersion: number,
): FnfDecision {
  const from = row.status;
  if (!allowedFrom(action).includes(from)) {
    return { ok: false, status: 409, code: "FNF_INVALID_TRANSITION", message: `cannot ${action} a settlement that is ${from}` };
  }
  if (row.version !== expectedVersion) {
    return { ok: false, status: 409, code: "FNF_VERSION_CONFLICT", message: "the settlement changed since you loaded it; refresh and try again" };
  }
  if (actor.roles && !rolesFor(action, from).some((r) => actor.roles!.includes(r))) {
    return { ok: false, status: 403, code: "FORBIDDEN", message: `requires one of: ${rolesFor(action, from).join(", ")}` };
  }
  // Segregation of duties. Reject inherits the rule of the forward step it
  // replaces, so nobody can veto their own work either.
  const checksApproval = action === "finance-approve" || (action === "reject" && from === "submitted");
  const checksDisbursal = action === "disburse" || (action === "reject" && from === "finance_approved");
  if (checksApproval && (actor.id === row.submittedBy || actor.id === computerOf(row))) {
    return { ok: false, status: 403, code: "FNF_SELF_APPROVAL_FORBIDDEN", message: "a settlement must be finance-approved by someone other than whoever computed or submitted it" };
  }
  if (checksDisbursal && (actor.id === row.financeApprovedBy || actor.id === row.submittedBy || actor.id === computerOf(row))) {
    return { ok: false, status: 403, code: "FNF_SELF_DISBURSAL_FORBIDDEN", message: "a settlement must be disbursed by someone other than whoever computed, submitted or finance-approved it" };
  }
  return { ok: true, from, to: TARGET[action] };
}
