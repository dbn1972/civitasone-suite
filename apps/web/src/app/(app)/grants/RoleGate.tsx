import type { ReactNode } from "react";
import { getSessionRoles, hasAnyRole } from "@/lib/auth/roleGuard";
import { PermissionDenied } from "../../_components/PermissionDenied";

/**
 * Per-route grants gate. The module layout admits the broad GRANTS_VIEW_ROLES;
 * this narrows a route to the roles grant-service admits on that page's primary
 * read endpoint (see the GRANTS_*_READ_ROLES sets in ./roles) so a role that would
 * only hit a 403 gets an honest "Access restricted" screen with a way back to the
 * hub. UX only — grant-service remains the authority.
 */
export function GrantsRoleGate({ roles, children }: { roles: readonly string[]; children: ReactNode }) {
  if (!hasAnyRole(getSessionRoles(), roles)) {
    return <PermissionDenied backHref="/grants" backLabel="Back to Grants" />;
  }
  return <>{children}</>;
}
