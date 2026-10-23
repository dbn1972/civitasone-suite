import { SALARY_ADMIN_ROLES } from "./_salaryAdminRoles";

/**
 * GAP-PAYROLL-SLIPS-DETAIL-06: where "Back" goes from a payslip, by role. ONE
 * function shared by page.tsx (the header back link) and error.tsx (the route
 * error boundary), so the two can never disagree again.
 *
 * - Payroll/salary admins -> the org-wide salary-slips list.
 * - Everyone else who may open a slip (an employee viewing their own) -> "My
 *   payslips". Not /hr/payroll: that page is READER_ROLES-only and would greet
 *   an employee with "Access restricted". my-slips admits PAYROLL_EMPLOYEE_ROLES
 *   (admins + employee), so the target is always openable by whoever lands here.
 *
 * Pure and client-safe (no server-only imports) so the client error boundary can
 * use it with the roles from useSessionIdentity().
 */
export type SlipBackTarget = {
  href: "/hr/payroll/salary-slips" | "/hr/payroll/my-slips";
  /** Key in the `payrollRouteError` i18n namespace. */
  labelKey: "backToSalarySlips" | "backToMyPayslips";
};

export function slipBackTarget(roles: readonly string[]): SlipBackTarget {
  return roles.some((r) => (SALARY_ADMIN_ROLES as readonly string[]).includes(r))
    ? { href: "/hr/payroll/salary-slips", labelKey: "backToSalarySlips" }
    : { href: "/hr/payroll/my-slips", labelKey: "backToMyPayslips" };
}
