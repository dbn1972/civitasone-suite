import type { ReactNode } from "react";
import { requireAnyRole } from "@/lib/auth/roleGuard";

/**
 * GAP-CRM-GRIEVANCES-NEW-03: the grievance-category master is platform-wide
 * taxonomy that governs every grievance, so it is gated to CRM admins exactly
 * like the sibling admin-config routes (lead-reason-codes, document-types,
 * service-types). A non-admin would otherwise reach a fully-wired Save/Delete
 * UI for tenant-wide config.
 */
const ALLOWED_ROLES = ["crm_admin", "admin", "super_admin", "platform_admin", "tenant_admin"];

export default function GrievanceCategoriesLayout({ children }: { children: ReactNode }) {
  requireAnyRole(ALLOWED_ROLES, "/crm");
  return <>{children}</>;
}
