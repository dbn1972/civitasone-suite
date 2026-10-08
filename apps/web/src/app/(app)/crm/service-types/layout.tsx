import type { ReactNode } from "react";
import { requireAnyRole } from "@/lib/auth/roleGuard";

/**
 * GAP-CRM-SERVICE-REQUESTS-NEW-02: the service-type master is platform-wide
 * taxonomy that governs every service request, so it is gated to CRM admins
 * exactly like the sibling admin-config routes (lead-reason-codes,
 * document-types). A non-admin would otherwise reach a fully-wired
 * Save/Delete UI for tenant-wide config.
 */
// GAP2-CRM-SERVICE-TYPES-03: match the backing service-requests routes exactly.
// crm-service service-requests routes gate writes with
// ADMIN_ROLES = [crm_admin, super_admin, tenant_admin] and reads with
// [crm_user, crm_admin, super_admin, tenant_admin] (service-requests/routes.ts).
// admin and platform_admin are accepted by none of those routes, so admitting
// them here gave a wired Save/Delete UI that 403'd on write. Narrowed to the
// server set so the gate and the route agree (parity).
const ALLOWED_ROLES = ["crm_admin", "super_admin", "tenant_admin"];

export default function ServiceTypesLayout({ children }: { children: ReactNode }) {
  requireAnyRole(ALLOWED_ROLES, "/crm");
  return <>{children}</>;
}
