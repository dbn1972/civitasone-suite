import type { ReactNode } from "react";
import { requireAnyRole } from "@/lib/auth/roleGuard";

/**
 * GAP-DOMAINS-NEW-05: module gate for /domains.
 *
 * Before this, any authenticated user reached /domains/new (no layout at all).
 * Domain registration writes a platform-wide government-domain registry and
 * collects personal contact data (DPDP), so it is restricted — fail-closed —
 * to platform/tenant administrators. There is no domain-specific role in this
 * snapshot, so the conservative admin set is used.
 *
 * NOTE: this is the WEB gate only. The matching SERVER enforcement
 * (requireRole on POST /api/v1/domains) cannot be added here because the
 * domain-service / gateway route is absent from this snapshot — see HUMAN
 * REVIEW. UI hiding alone is not a complete authorization fix.
 */
const DOMAINS_ADMIN_ROLES = ["platform_admin", "tenant_admin", "super_admin", "admin"];

export default function DomainsLayout({ children }: { children: ReactNode }) {
  requireAnyRole(DOMAINS_ADMIN_ROLES);
  return <>{children}</>;
}
