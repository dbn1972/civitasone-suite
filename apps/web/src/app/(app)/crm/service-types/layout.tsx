import type { ReactNode } from "react";
import { requireAnyRole } from "@/lib/auth/roleGuard";

/**
 * GAP-CRM-SERVICE-REQUESTS-NEW-02: the service-type master is platform-wide
 * taxonomy that governs every service request, so it is gated to CRM admins
 * exactly like the sibling admin-config routes (lead-reason-codes,
 * document-types). A non-admin would otherwise reach a fully-wired
 * Save/Delete UI for tenant-wide config.
 */
const ALLOWED_ROLES = ["crm_admin", "admin", "super_admin", "platform_admin", "tenant_admin"];

export default function ServiceTypesLayout({ children }: { children: ReactNode }) {
  requireAnyRole(ALLOWED_ROLES, "/crm");
  return <>{children}</>;
}
