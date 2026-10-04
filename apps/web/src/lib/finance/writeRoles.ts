/**
 * Roles finance-service admits on the WRITE routes behind the finance buttons
 * that were previously offered to every reader (so a reader got a button that
 * only returned 403). Derived from the service source:
 *  - vendors PATCH/POST: WRITER_ROLES in masters/routes.ts
 *  - recurring-entries PATCH/POST: FINANCE_ROLES in recurring/routes.ts
 * The server stays the authority; this only avoids offering a dead control.
 */
export const VENDOR_WRITE_ROLES = ["finance_admin", "super_admin"] as const;
/**
 * GAP-FINANCE-EXPENDITURE-BILLS-05: POST /v1/finance/bills and POST
 * /v1/finance/advances are guarded by FINANCE_ROLES in payments/routes.ts, while
 * the module-wide web gate also admits read-only roles (audit_officer,
 * procurement_officer, ...). Only these roles are offered the "New ..." link.
 */
export const BILL_CREATE_ROLES = ["finance_officer", "finance_admin", "super_admin"] as const;
export const ADVANCE_CREATE_ROLES = BILL_CREATE_ROLES;
/** PATCH /v1/finance/bills/:id/approve -> APPROVER_ROLES in payments/routes.ts. */
export const BILL_APPROVE_ROLES = ["accounts_officer", "finance_admin", "super_admin"] as const;
export const RECURRING_WRITE_ROLES = ["finance_officer", "finance_admin", "super_admin"] as const;

/**
 * fp-finance-02: roles finance-service admits on the new audited / maker-checker routes (derived from
 * masters/vendor-workflow-routes.ts, instruments/routes.ts and audit/routes.ts). The server is the
 * authority; these only avoid offering a control that would 403.
 */
export const VENDOR_APPROVE_ROLES = ["finance_admin", "super_admin"] as const;
/** Reveal masked vendor PAN / account / phone / email (audited with a reason). */
export const VENDOR_PII_REVEAL_ROLES = ["finance_officer", "finance_admin", "accounts_officer", "super_admin"] as const;
/** Export the vendor register as CSV (audited). */
export const VENDOR_EXPORT_ROLES = ["finance_officer", "finance_admin", "accounts_officer", "super_admin"] as const;
/** Reveal a cheque's drawn-on bank account number (audited with a reason). */
export const BANK_ACCOUNT_REVEAL_ROLES = ["finance_officer", "finance_admin", "accounts_officer", "super_admin"] as const;
/** POST /v1/finance/reappropriations/:id/submit-approval -> FINANCE_ROLES in budget/routes.ts. */
export const REAPPROPRIATION_SUBMIT_ROLES = ["finance_officer", "finance_admin", "super_admin"] as const;
/** Record a department reply / escalate an audit para. */
export const AUDIT_PARA_ACT_ROLES = ["finance_officer", "finance_admin", "super_admin"] as const;
/** Settle (close) an audit para. */
export const AUDIT_PARA_SETTLE_ROLES = ["finance_admin", "super_admin"] as const;

/**
 * True when the session may use a write control. An EMPTY role list means the
 * session carries no role claim (the /finance layout fails open for that case),
 * so the control is NOT hidden -- the server decides.
 */
export function canWrite(sessionRoles: readonly string[], allowed: readonly string[]): boolean {
  if (sessionRoles.length === 0) return true;
  return sessionRoles.some((r) => allowed.includes(r));
}
