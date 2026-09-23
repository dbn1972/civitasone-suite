import { getSessionRoles } from "@/lib/auth/roleGuard";
import { PermissionDenied } from "../../../../_components/PermissionDenied";
import { NewDesignationPageClient } from "./NewDesignationPageClient";

/**
 * Mirrors services/hrms-service/src/modules/employee/masters-routes.ts's
 * HR_ROLES guard on POST /v1/hrms/designations exactly (same constant the
 * backend reuses for both departments and designations in that file).
 *
 * See hr/departments/new/page.tsx for the full rationale -- same pattern,
 * same underlying finding (a fully working, live-but-doomed admin form with
 * no indication it would be rejected on submit).
 */
const DESIGNATION_ADMIN_ROLES = ["hr_admin", "super_admin", "admin"];

export default function NewDesignationPage() {
  const roles = getSessionRoles();
  const canAdminister = roles.some((r) => DESIGNATION_ADMIN_ROLES.includes(r));

  if (!canAdminister) {
    return <PermissionDenied module="adding a designation" requiredRoles={DESIGNATION_ADMIN_ROLES} />;
  }

  return <NewDesignationPageClient />;
}
