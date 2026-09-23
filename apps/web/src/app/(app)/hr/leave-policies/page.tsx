import { getSessionRoles } from "@/lib/auth/roleGuard";
import { PermissionDenied } from "../../../_components/PermissionDenied";
import LeavePoliciesClient from "./LeavePoliciesClient";

/**
 * Mirrors leave/routes.ts: POST /v1/hrms/leave-types and the policy-admin
 * PATCH endpoint both require HR_ROLES. The entire policy management UI is
 * gated to these roles — other roles have no legitimate use for it.
 */
const LEAVE_POLICY_ADMIN_ROLES = ["hr_admin", "hr_officer", "super_admin"];

export default function LeavePoliciesPage() {
  const roles = getSessionRoles();
  const canAccess = roles.some((r: string) => LEAVE_POLICY_ADMIN_ROLES.includes(r));

  if (!canAccess) {
    return <PermissionDenied module="leave policy management" requiredRoles={LEAVE_POLICY_ADMIN_ROLES} />;
  }

  return <LeavePoliciesClient />;
}
