import type { ReactNode } from "react";
import { requireAnyRole, CRM_DEDUP_RULES_ROLES } from "@/lib/auth/roleGuard";

/**
 * Editing duplicate-matching rules changes how every record is deduplicated,
 * so it is restricted to CRM administrators.
 *
 * GAP-CRM-DEDUP-RULES-05: the allow-list is CRM_DEDUP_RULES_ROLES -- the roles
 * that clear the parent CRM layout AND that crm-service admits on GET/PUT
 * /v1/crm/dedup-rules (crm_admin, super_admin). It used to be the broader
 * CRM_ADMIN_ROLES, whose extra members could not use the page: admin /
 * platform_admin never pass the parent CRM layout, and tenant_admin passed both
 * web layouts only to get a 403 from the server. NARROWING the web gate to the
 * server's own set changes nobody's real access; WIDENING it (letting
 * tenant_admin manage tenant-wide dedup rules) would be an access-control
 * change that needs the backend ADMIN_ROLES changed first and security
 * sign-off, so it was NOT done here. This layout stays the real boundary for
 * the sub-gate; anyone else is redirected to /crm/data-quality.
 */
export default function DedupRulesLayout({ children }: { children: ReactNode }) {
  requireAnyRole(CRM_DEDUP_RULES_ROLES, "/crm/data-quality");
  return <>{children}</>;
}
