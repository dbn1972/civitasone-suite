import { HR_SELF_SERVICE_ROLES } from "@/lib/auth/workRoles";

/**
 * GAP-FINANCE-PAYMENTS-DETAIL-02: which employee directory a signed-in role may search.
 *
 *  - "hrms": GET /v1/hrms/employees, gated to DIRECTORY_ROLES (HR staff, manager, employee, payroll
 *    admin/officer). A bare manager is scoped to direct reports by the service.
 *  - "payroll": GET /v1/payroll/employee-lookup (id / employee no / name / department only), gated to
 *    LOOKUP_ROLES. It is what finance_officer can reach.
 *  - "none": the role is on neither list (finance_admin today), so a picker would only ever 403.
 *
 * This mirrors the two services' role lists for DISPLAY only (which source to ask, or to say plainly
 * that there is none); each service still enforces its own gate, so a wrong answer can never grant
 * access. With no known roles (session not loaded) it returns "hrms", the picker's default.
 */
export type EmployeeDirectory = "hrms" | "payroll" | "none";

const HRMS_DIRECTORY_ROLES: readonly string[] = [...HR_SELF_SERVICE_ROLES, "payroll_admin", "payroll_officer"];
const PAYROLL_LOOKUP_ROLES: readonly string[] = ["payroll_admin", "payroll_officer", "super_admin", "hr_admin", "finance_officer"];

export function employeeDirectoryForRoles(roles: readonly string[]): EmployeeDirectory {
  if (roles.length === 0) return "hrms";
  if (roles.some((r) => HRMS_DIRECTORY_ROLES.includes(r))) return "hrms";
  if (roles.some((r) => PAYROLL_LOOKUP_ROLES.includes(r))) return "payroll";
  return "none";
}
