import type { ReactNode } from "react";
import { requireAnyRole } from "@/lib/auth/roleGuard";
import { GRANTS_MAKER_ROLES } from "../../../roles";

// GAP-GRANTS-SCHEMES-DETAIL-APPLY-04: filing a grant application on a grantee's
// behalf is a maker (intake-staff) action — the grant-service POST
// /schemes/:id/applications enforces GRANT_ROLES. Gate the route so a user
// outside those roles is redirected instead of reaching a form whose submit is
// guaranteed to 403. The server stamps submittedBy from the JWT and audits it.
export default function ApplyLayout({ children }: { children: ReactNode }) {
  requireAnyRole(GRANTS_MAKER_ROLES, "/grants/schemes");
  return <>{children}</>;
}
