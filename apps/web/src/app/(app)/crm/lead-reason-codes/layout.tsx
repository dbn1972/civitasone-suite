import type { ReactNode } from "react";
import { requireAnyRole } from "@/lib/auth/roleGuard";

/**
 * Lead disqualification reason codes are shared taxonomy used across every lead record.
 * Sibling admin-config routes (custom-fields, dedup-rules) already gate this
 * way; this route fell through to the broad CRM layout only (any crm_user),
 * so a non-admin could load and interact with a fully-wired Save/Delete UI
 * for platform-wide config that only admins should see.
 */
const ALLOWED_ROLES = ["crm_admin", "admin", "super_admin", "platform_admin", "tenant_admin"];

export default function LeadReasonCodesLayout({ children }: { children: ReactNode }) {
  requireAnyRole(ALLOWED_ROLES, "/crm");
  return <>{children}</>;
}
