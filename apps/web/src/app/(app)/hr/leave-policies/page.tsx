import { getSessionRoles } from "@/lib/auth/roleGuard";
import { LEAVE_POLICY_ADMIN_ROLES } from "@/lib/auth/workRoles";
import { PermissionDenied } from "../../../_components/PermissionDenied";
import LeavePoliciesClient from "./LeavePoliciesClient";

/**
 * GAP-HR-LEAVE-POLICIES-01/02: role list moved to the shared
 * apps/web/src/lib/auth/workRoles.ts (LEAVE_POLICY_ADMIN_ROLES) so this page
 * and hr/leave/page.tsx's "Policies" link gate (canManagePolicies) cannot
 * drift apart, and so it mirrors policy-admin-routes.ts's backend list
 * exactly. See that constant's doc comment for why "admin" was dropped and
 * tenant_admin/platform_admin were added.
 */
export default function LeavePoliciesPage() {
  const roles = getSessionRoles();
  const canAccess = roles.some((r: string) => LEAVE_POLICY_ADMIN_ROLES.includes(r));

  if (!canAccess) {
    return <PermissionDenied module="leave policy management" requiredRoles={LEAVE_POLICY_ADMIN_ROLES} />;
  }

  return <LeavePoliciesClient />;
}
