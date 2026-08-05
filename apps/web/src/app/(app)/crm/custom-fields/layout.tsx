import type { ReactNode } from "react";
import { requireAnyRole } from "@/lib/auth/roleGuard";

/**
 * Custom-field definitions change how every record of an entity is captured,
 * so editing them is restricted to CRM administrators.
 */
const ALLOWED_ROLES = ["crm_admin", "admin", "super_admin", "platform_admin", "tenant_admin"];

export default function CustomFieldsLayout({ children }: { children: ReactNode }) {
  requireAnyRole(ALLOWED_ROLES, "/crm");
  return <>{children}</>;
}
