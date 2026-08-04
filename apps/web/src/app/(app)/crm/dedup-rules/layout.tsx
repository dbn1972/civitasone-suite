import type { ReactNode } from "react";
import { requireAnyRole } from "@/lib/auth/roleGuard";

/**
 * Editing duplicate-matching rules changes how every record is deduplicated,
 * so it is restricted to CRM administrators.
 */
const ALLOWED_ROLES = ["crm_admin", "admin", "super_admin", "platform_admin", "tenant_admin"];

export default function DedupRulesLayout({ children }: { children: ReactNode }) {
  requireAnyRole(ALLOWED_ROLES, "/crm/data-quality");
  return <>{children}</>;
}
