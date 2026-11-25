import type { ReactNode } from "react";
import { requireAnyRole } from "@/lib/auth/roleGuard";
import { LEGAL_OPERATOR_ROLES } from "@/lib/auth/navRoles";

// legal-service gates every /v1/legal/notices route (list, create, respond) on
// legal_officer / legal_admin / super_admin (notices/routes.ts LEGAL_ROLES). audit_officer clears
// the module gate but would 403 on every call here, so it is sent back to the Legal hub.
export default function LegalNoticesLayout({ children }: { children: ReactNode }) {
  requireAnyRole(LEGAL_OPERATOR_ROLES, "/legal");
  return <>{children}</>;
}
