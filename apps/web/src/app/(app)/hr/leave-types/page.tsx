import { getSessionRoles } from "@/lib/auth/roleGuard";
import { LEAVE_POLICY_ADMIN_ROLES } from "@/lib/auth/workRoles";
import { PermissionDenied } from "../../../_components/PermissionDenied";
import LeaveTypesClient from "./LeaveTypesClient";

/**
 * S8-G3: organisation-defined leave types (create / edit / deactivate with approval).
 * Same role set as the leave-policy screen, mirroring hrms-service type-admin-routes.ts.
 */
export default function LeaveTypesPage() {
  const roles = getSessionRoles();
  const canAccess = roles.some((r: string) => LEAVE_POLICY_ADMIN_ROLES.includes(r));
  if (!canAccess) {
    return <PermissionDenied module="leave type management" requiredRoles={LEAVE_POLICY_ADMIN_ROLES} />;
  }
  return <LeaveTypesClient />;
}
