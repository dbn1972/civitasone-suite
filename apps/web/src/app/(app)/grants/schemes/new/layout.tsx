import type { ReactNode } from "react";
import { requireAnyRole } from "@/lib/auth/roleGuard";
import { GRANTS_MAKER_ROLES } from "../../roles";

// GAP-GRANTS-SCHEMES-NEW-01: creating a scheme is a maker action. The grants
// module layout already gates on the reader roles; this route layout narrows
// it to the maker roles (grant-service POST /schemes enforces the same set).
// A non-maker is redirected back to the schemes list rather than shown a form
// whose submit is guaranteed to 403.
export default function NewSchemeLayout({ children }: { children: ReactNode }) {
  requireAnyRole(GRANTS_MAKER_ROLES, "/grants/schemes");
  return <>{children}</>;
}
