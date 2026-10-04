/**
 * Roles finance-service admits on GET /v1/finance/pfms/:id/bank-file
 * (FINANCE_ROLES in the pfms module's routes). The bank file carries
 * beneficiary account numbers, IFSC and amounts (DPDP-sensitive), so the
 * download affordance is offered only to these roles instead of every member
 * of the broader /finance layout role set (GAP-FINANCE-PFMS-03). The server
 * stays the authority; this just avoids offering a button that would 403.
 */
export const PFMS_BANK_FILE_ROLES = ["finance_officer", "finance_admin", "super_admin"] as const;

/**
 * True when the session may download a bank file. An EMPTY role list means the
 * session carries no role claim (the /finance layout fails open for that case),
 * so the button is not hidden -- the server decides.
 */
export function canDownloadBankFile(sessionRoles: readonly string[]): boolean {
  if (sessionRoles.length === 0) return true;
  return sessionRoles.some((r) => (PFMS_BANK_FILE_ROLES as readonly string[]).includes(r));
}

/** Roles finance-service admits on POST /v1/finance/pfms/batches/:id/release (money movement: admins only). */
export const PFMS_RELEASE_ROLES = ["finance_admin", "super_admin"] as const;

/** Same fail-open rule as the bank-file check: an empty role list means no role claim, so the server decides. */
export function canReleaseBatch(sessionRoles: readonly string[]): boolean {
  if (sessionRoles.length === 0) return true;
  return sessionRoles.some((r) => (PFMS_RELEASE_ROLES as readonly string[]).includes(r));
}
