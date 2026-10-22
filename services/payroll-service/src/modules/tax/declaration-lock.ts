/**
 * GAP-PAYROLL-TAX-DECLARATION-05: a declaration that payroll has VERIFIED or
 * APPROVED (both are valid payroll_tax_declarations.status values, see
 * migration 0027) is read-only -- the employee's resubmission must not silently
 * replace what payroll already relied on for TDS / Form 16.
 *
 * Nothing in this service sets either status yet (the consumer writes
 * 'submitted'); the lock is the safe default for the day a verification step
 * does, and it is enforced twice: in the POST route (409 DECLARATION_LOCKED,
 * for the person) and in the consumer's upsert (so a command that was queued
 * before the status changed, or published by another path, cannot overwrite a
 * locked row). WHO may verify or re-open a declaration is a payroll-policy
 * decision that is deliberately NOT made here: no role can edit a locked
 * declaration through this API.
 */
export const LOCKED_DECLARATION_STATUSES = ["verified", "approved"] as const;

export function isDeclarationLocked(status: string | null | undefined): boolean {
  return status != null && (LOCKED_DECLARATION_STATUSES as readonly string[]).includes(status);
}
