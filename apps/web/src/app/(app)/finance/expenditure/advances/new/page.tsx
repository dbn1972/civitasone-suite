import { getSessionRoles } from "@/lib/auth/roleGuard";
import { EMPLOYEE_LOOKUP_ROLES } from "@/lib/auth/workRoles";
import { NewAdvanceForm } from "./NewAdvanceForm";

/**
 * New Advance. The form is a client component; this wrapper only decides, from the session roles, whether the viewer
 * may search the payroll employee lookup (GAP-FINANCE-EXPENDITURE-ADVANCES-NEW-03). payroll-service enforces the same
 * list on GET /v1/payroll/employee-lookup, so this is a convenience that keeps a role without access (finance_admin)
 * off an officer picker that could only fail.
 */
export default function NewAdvancePage() {
  const canPickEmployees = getSessionRoles().some((r) => (EMPLOYEE_LOOKUP_ROLES as readonly string[]).includes(r));
  return <NewAdvanceForm canPickEmployees={canPickEmployees} />;
}
