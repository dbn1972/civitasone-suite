import type { ReactNode } from "react";
import { requireAnyRole, CRM_ADMIN_WRITE_ROLES } from "@/lib/auth/roleGuard";

/**
 * POST /v1/crm/contacts/bulk/import is crm_admin / super_admin only in crm-service, so a plain
 * crm_user (or tenant_admin) used to fill in a whole CSV and only then be 403d. Gate the page on the
 * server set; everyone else goes back to the contacts list. The server stays the authority.
 */
export default function ContactsImportLayout({ children }: { children: ReactNode }) {
  requireAnyRole(CRM_ADMIN_WRITE_ROLES, "/crm/contacts");
  return <>{children}</>;
}
