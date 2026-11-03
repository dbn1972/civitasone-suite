/**
 * UAT b15 item 3: who the tax declaration screen is for, from the session roles, so the page never has to probe the
 * API (and log two failed requests) to find out.
 *
 * Mirrors payroll-service src/modules/tax/routes.ts: GET /v1/payroll/tax-declarations admits READER_ROLES, and its
 * staff (READER_STAFF_ROLES = READER_ROLES minus `employee`) must name the employee they file for (400 without
 * employeeId). GET /v1/payroll/tax-proofs/mine is the `employee` role only. A contract test
 * (TaxDeclaration.b15.test.tsx) reads the service source, so the two lists cannot drift apart.
 */
export const TAX_DECLARATION_STAFF_ROLES = ["payroll_admin", "payroll_officer", "super_admin", "hr_admin", "finance_officer"] as const;
export const TAX_SELF_SERVICE_ROLE = "employee";

/** Payroll / HR staff: file on behalf of a chosen employee. */
export function isTaxDeclarationStaff(roles: readonly string[]): boolean {
  return TAX_DECLARATION_STAFF_ROLES.some((r) => roles.includes(r));
}

/** Holds the self-service employee role (own declaration, own proofs). */
export function isSelfServiceEmployee(roles: readonly string[]): boolean {
  return roles.includes(TAX_SELF_SERVICE_ROLE);
}
