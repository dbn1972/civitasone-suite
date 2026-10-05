import type { ReactNode } from "react";
import { requireAnyRole, CRM_ADMIN_ROLES } from "@/lib/auth/roleGuard";

/**
 * Editing duplicate-matching rules changes how every record is deduplicated,
 * so it is restricted to CRM administrators.
 *
 * GAP-CRM-DEDUP-RULES-05: this used a locally-declared ALLOWED_ROLES that could
 * drift from the shared CRM admin set; it now reuses the single-source-of-truth
 * CRM_ADMIN_ROLES from lib/auth/roleGuard (the same set the CRM hub and the
 * /crm/data-quality "Matching rules" link gate on). The parent CRM layout
 * already requires one of {crm_user, crm_admin, platform_admin, super_admin},
 * so an "admin"/"tenant_admin" in that set only reaches this route if they ALSO
 * hold a CRM role — that is intentional (CRM is a CRM-role-gated module;
 * widening the module gate to tenant admins would be an access-control change
 * requiring security sign-off, so it was NOT done here). This layout stays the
 * real boundary for the sub-gate; a non-admin is redirected to /crm/data-quality.
 */
export default function DedupRulesLayout({ children }: { children: ReactNode }) {
  requireAnyRole(CRM_ADMIN_ROLES, "/crm/data-quality");
  return <>{children}</>;
}
