import { getSessionRoles } from "@/lib/auth/roleGuard";
import { PermissionDenied } from "../../../../_components/PermissionDenied";
import { NewDepartmentPageClient } from "./NewDepartmentPageClient";

/**
 * Mirrors services/hrms-service/src/modules/employee/masters-routes.ts's
 * HR_ROLES guard on POST /v1/hrms/departments exactly.
 *
 * hr/layout.tsx deliberately admits every HR-adjacent role (including plain
 * "employee") into this whole /hr tree -- each page is responsible for its
 * own finer-grained check. Without this one, a role like "employee" reached
 * a fully working "Add Department" form (Code/Name fields, working submit
 * button) with no indication it would ever work; the backend correctly
 * rejected the submit with 403, but only after the user filled it in.
 */
const DEPARTMENT_ADMIN_ROLES = ["hr_admin", "super_admin", "admin"];

export default function NewDepartmentPage() {
  const roles = getSessionRoles();
  const canAdminister = roles.some((r) => DEPARTMENT_ADMIN_ROLES.includes(r));

  if (!canAdminister) {
    return <PermissionDenied module="adding a department" requiredRoles={DEPARTMENT_ADMIN_ROLES} />;
  }

  return <NewDepartmentPageClient />;
}
