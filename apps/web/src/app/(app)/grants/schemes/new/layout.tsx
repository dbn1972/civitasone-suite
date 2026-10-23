import type { ReactNode } from "react";
import { getSessionRoles, hasAnyRole } from "@/lib/auth/roleGuard";
import { PermissionDenied } from "../../../../_components/PermissionDenied";
import { GRANTS_MAKER_ROLES } from "../../roles";

// GAP-GRANTS-SCHEMES-NEW-01: creating a scheme is a maker action. The grants
// module layout already gates on the reader roles; this route layout narrows
// it to the maker roles (grant-service POST /schemes enforces the same set).
// A non-maker sees PermissionDenied (linking back to the schemes list) rather
// than a form whose submit is guaranteed to 403.
export default function NewSchemeLayout({ children }: { children: ReactNode }) {
  if (!hasAnyRole(getSessionRoles(), GRANTS_MAKER_ROLES)) {
    return <PermissionDenied backHref="/grants/schemes" backLabel="Back to schemes" />;
  }
  return <>{children}</>;
}
