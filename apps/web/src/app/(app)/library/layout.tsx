import type { ReactNode } from "react";
import { requireAnyRole, PLATFORM_ADMIN_ROLES } from "@/lib/auth/roleGuard";

/**
 * GAP-LIBRARY-HOME-02 / HOME-03: the (app)/library route is a static,
 * developer-maintained catalogue of audit finding TYPES (see page.tsx). It is
 * platform/engineering reference content — the same for every tenant and not
 * per-tenant data — so a tenant-role user (employee, hr_staff, crm_user, …)
 * must not land on engineering findings. Previously only (app)/layout.tsx ran,
 * so there was no role gate at all (unlike legal/layout.tsx).
 *
 * DECISION (safest default, fail closed — flagged for HUMAN REVIEW): restrict
 * to PLATFORM_ADMIN_ROLES (platform_admin / super_admin / tenant_admin, the
 * same set the /platform-admin segment uses). This keeps the live reference
 * view reachable for the admins who maintain the platform while removing it
 * from every ordinary tenant user. There is no "library" module key (the real
 * document library is the separate /estab/library route), so no ModuleGate is
 * applied here. requireAnyRole redirects unauthorised users to /dashboard.
 */
export default function LibraryLayout({ children }: { children: ReactNode }) {
  requireAnyRole(PLATFORM_ADMIN_ROLES);
  return <>{children}</>;
}
