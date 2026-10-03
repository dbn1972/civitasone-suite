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
 * True when the session may use a write control. An EMPTY role list means the
 * session carries no role claim (the /finance layout fails open for that case),
 * so the control is NOT hidden -- the server decides.
 */
export function canWrite(sessionRoles: readonly string[], allowed: readonly string[]): boolean {
  if (sessionRoles.length === 0) return true;
  return sessionRoles.some((r) => allowed.includes(r));
}
