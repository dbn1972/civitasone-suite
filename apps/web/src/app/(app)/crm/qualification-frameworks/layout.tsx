import type { ReactNode } from "react";
import { requireAnyRole, CRM_ADMIN_ROLES } from "@/lib/auth/roleGuard";

/**
 * Qualification frameworks change what every rep is required to capture before a lead can progress.
 * Sibling admin-config routes (custom-fields, dedup-rules) already gate this
 * way; this route fell through to the broad CRM layout only (any crm_user),
 * so a non-admin could load and interact with a fully-wired Save/Delete UI
 * for platform-wide config that only admins should see.
 */
export default function QualificationFrameworksLayout({ children }: { children: ReactNode }) {
  requireAnyRole(CRM_ADMIN_ROLES, "/crm");
  return <>{children}</>;
}
