import type { ReactNode } from "react";
import { getSessionRoles, hasAnyRole } from "@/lib/auth/roleGuard";
import { PermissionDenied } from "../../../../../_components/PermissionDenied";
import { GRANTS_MAKER_ROLES } from "../../../roles";

// GAP-GRANTS-SCHEMES-DETAIL-APPLY-04: filing a grant application on a grantee's
// behalf is a maker (intake-staff) action — the grant-service POST
// /schemes/:id/applications enforces GRANT_ROLES. A user outside those roles
// sees PermissionDenied instead of a form whose submit is guaranteed to 403.
// The server stamps submittedBy from the JWT and audits it.
export default function ApplyLayout({ children }: { children: ReactNode }) {
  if (!hasAnyRole(getSessionRoles(), GRANTS_MAKER_ROLES)) {
    return <PermissionDenied backHref="/grants/schemes" backLabel="Back to schemes" />;
  }
  return <>{children}</>;
}
