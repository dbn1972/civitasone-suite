import type { ReactNode } from "react";
import { requireAnyRole, CRM_ADMIN_ROLES } from "@/lib/auth/roleGuard";

/**
 * Assignment rules change how every new lead/case is routed to an owner.
 * Sibling admin-config routes (custom-fields, dedup-rules) already gate this
 * way; this route fell through to the broad CRM layout only (any crm_user),
 * so a non-admin could load and interact with a fully-wired Save/Delete UI
 * for platform-wide config that only admins should see.
 */
export default function AssignmentRulesLayout({ children }: { children: ReactNode }) {
  requireAnyRole(CRM_ADMIN_ROLES, "/crm");
  return <>{children}</>;
}
