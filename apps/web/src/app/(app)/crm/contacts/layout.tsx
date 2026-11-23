import type { ReactNode } from "react";
import { requireAnyRole, CRM_CONTACT_READ_ROLES } from "@/lib/auth/roleGuard";

/**
 * Align the web gate with crm-service: every /v1/crm/contacts read (list, detail,
 * timeline, 360, import/export) admits crm_user, crm_admin and super_admin only
 * (modules/contacts/routes.ts CRM_ROLES). tenant_admin clears the parent CRM
 * layout (other CRM modules accept it) but the contacts list would 403, so it is
 * sent back to the CRM hub instead of a 403 wall. Narrowing only: crm-service
 * remains the authority and nothing here widens anyone's access.
 */
export default function ContactsLayout({ children }: { children: ReactNode }) {
  requireAnyRole(CRM_CONTACT_READ_ROLES, "/crm");
  return <>{children}</>;
}
