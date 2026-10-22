import { DelegationsPanel } from "../_components/DelegationsPanel";
import { getSessionRoles, getSessionUserId, WORKFLOW_DELEGATION_ADMIN_ROLES } from "@/lib/auth/roleGuard";

export const dynamic = "force-dynamic";

/**
 * My delegations. The session (JWT) supplies the signed-in user and the roles they hold; the role picker offers only
 * those. The workflow-service re-checks the roles against the token on every create.
 */
export default function MyDelegationsPage() {
  const roles = getSessionRoles();
  return (
    <DelegationsPanel
      userId={getSessionUserId()}
      roles={roles}
      canViewLegacy={WORKFLOW_DELEGATION_ADMIN_ROLES.some((r) => roles.includes(r))}
    />
  );
}
