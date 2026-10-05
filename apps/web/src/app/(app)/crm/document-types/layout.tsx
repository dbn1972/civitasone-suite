import type { ReactNode } from "react";
import { requireAnyRole, CRM_ADMIN_ROLES } from "@/lib/auth/roleGuard";

/**
 * Document-type definitions change what every upload across the CRM is validated against.
 * Sibling admin-config routes (custom-fields, dedup-rules) already gate this
 * way; this route fell through to the broad CRM layout only (any crm_user),
 * so a non-admin could load and interact with a fully-wired Save/Delete UI
 * for platform-wide config that only admins should see. Uses the shared
 * CRM_ADMIN_ROLES so the /crm/documents button-gate and this route guard agree
 * (GAP-CRM-DOCUMENTS-01).
 */
export default function DocumentTypesLayout({ children }: { children: ReactNode }) {
  requireAnyRole(CRM_ADMIN_ROLES, "/crm");
  return <>{children}</>;
}
