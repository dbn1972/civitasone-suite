import type { ReactNode } from "react";
import { requireAnyRole } from "@/lib/auth/roleGuard";
import { ModuleGate } from "../ModuleGate";
import { TENANT_ADMIN_ROLES } from "./_roles";

/**
 * GAP-TENANT-HOME-01 / GAP-TENANT-CONSENT-EXCHANGE-02: the /tenant area fans
 * out to tenant governance (usage, settings, DPDP consent requests, org
 * migrations, plans). It previously only checked module enablement
 * (ModuleGate) and a signed-in session (middleware), so every employee could
 * read tenant governance and DPDP consent data. Gate the whole area to the
 * tenant-admin role set (same set tenant-admin/layout.tsx uses) BEFORE the
 * module gate. The authoritative control remains server-side in tenant-service
 * (see tests tenant-usage-settings-authz / plans-overview-authz); this is the
 * defence-in-depth + UX layer that stops advertising pages a non-admin would
 * only be bounced out of. DECISION (safest default, flagged for HUMAN REVIEW):
 * reference-data readers (tenant_user) lose the /tenant hub even though
 * tenant-service lets them read code-lists; the dedicated tenant-admin area and
 * module config are the intended home, so a restrictive gate is preferred over
 * leaking governance tiles.
 */
export default function TenantLayout({ children }: { children: ReactNode }) {
  requireAnyRole(TENANT_ADMIN_ROLES);
  return <ModuleGate moduleKey="tenant">{children}</ModuleGate>;
}
