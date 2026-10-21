import { HR_STAFF_ROLES } from "@/lib/auth/workRoles";

/**
 * GAP-FINANCE-PAYMENTS-DETAIL-02: which employee directory a signed-in role may search.
 *
 *  - "hrms": GET /v1/hrms/employees, gated to DIRECTORY_ROLES (HR staff, manager, employee, payroll
 *    admin/officer). Only HR staff and payroll admin/officer see the whole tenant there; a caller who
 *    holds only manager and/or employee is scoped by the service to their own direct reports
 *    (resolveManagerScope in hrms-service employee/routes.ts), so the list is empty or near-empty.
 *  - "payroll": GET /v1/payroll/employee-lookup (id / employee no / name / department only), gated to
 *    LOOKUP_ROLES and tenant-wide. It is what finance_officer can reach.
 *  - "none": the role is on neither list (finance_admin today), so a picker would only ever 403.
 *
 * Order matters. A tenant-wide HRMS role wins. Otherwise a payroll-lookup role (finance_officer) uses the
 * tenant-wide payroll lookup EVEN IF the user also carries the scoped employee or manager role, because
 * the scoped HRMS list would leave that officer unable to pick an approving officer. Only then do the
 * scoped employee/manager roles fall back to the HRMS directory.
 *
 * This mirrors the two services' role lists for DISPLAY only (which source to ask, or to say plainly
 * that there is none); each service still enforces its own gate, so a wrong answer can never grant
 * access. With no known roles (session not loaded) it returns "hrms", the picker's default.
 */
export type EmployeeDirectory = "hrms" | "payroll" | "none";

/** Roles for which GET /v1/hrms/employees is tenant-wide (service: HR_ROLES + PAYROLL_DIRECTORY_ROLES). */
const HRMS_TENANT_WIDE_ROLES: readonly string[] = [...HR_STAFF_ROLES, "payroll_admin", "payroll_officer"];
/** Roles the HRMS list admits but scopes to the caller's direct reports (service: resolveManagerScope). */
const HRMS_SCOPED_ROLES: readonly string[] = ["manager", "employee"];
/** Mirrors payroll-service employee-lookup LOOKUP_ROLES. */
const PAYROLL_LOOKUP_ROLES: readonly string[] = ["payroll_admin", "payroll_officer", "super_admin", "hr_admin", "finance_officer"];

export function employeeDirectoryForRoles(roles: readonly string[]): EmployeeDirectory {
  if (roles.length === 0) return "hrms";
  if (roles.some((r) => HRMS_TENANT_WIDE_ROLES.includes(r))) return "hrms";
  if (roles.some((r) => PAYROLL_LOOKUP_ROLES.includes(r))) return "payroll";
  if (roles.some((r) => HRMS_SCOPED_ROLES.includes(r))) return "hrms";
  return "none";
}
