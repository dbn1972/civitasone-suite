import type { ReactNode } from "react";
import { requireAnyRole } from "@/lib/auth/roleGuard";
import { LEGAL_OPERATOR_ROLES } from "@/lib/auth/navRoles";

// legal-service admits only legal_officer / legal_admin / super_admin on the data calls behind
// this route; audit_officer clears the module gate (read-only reader elsewhere) but would hit a
// 403 here, so it is sent back to the Legal hub. Narrowing only; the server stays authoritative.
export default function LegalOperatorLayout({ children }: { children: ReactNode }) {
  requireAnyRole(LEGAL_OPERATOR_ROLES, "/legal");
  return <>{children}</>;
}
