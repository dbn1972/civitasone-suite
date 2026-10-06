import type { ReactNode } from "react";
import { requireAnyRole, PLATFORM_ADMIN_ROLES, PLATFORM_AUDIT_VIEW_ROLES } from "@/lib/auth/roleGuard";

/**
 * Role gate for the whole /platform-admin segment — system settings, org
 * configuration, roles & permissions, audit log and user management
 * (GAP-PLATFORM-ADMIN-ROLES-02 / -SYSTEM-SETTINGS-03 / -AUDIT-LOG-02 /
 * -ORG-CONFIG-02 / -HOME-01).
 *
 * Before this layout existed the segment had no requireAnyRole anywhere: the
 * app shell only checked that an access cookie was present, so any signed-in
 * tenant user who typed /platform-admin reached the editable role matrix,
 * tenant-wide security settings, org-taxonomy editor and the full audit log
 * (actor, IP, role of every event). Hiding the home-page button was the only
 * "protection". This gate redirects anyone outside PLATFORM_ADMIN_ROLES to
 * /dashboard. The backend services remain the authority (defence in depth);
 * see the per-service tests added for HOME-01 / AUDIT-LOG-02 / ORG-CONFIG-02 /
 * ROLES-01.
 */
export default function PlatformAdminLayout({ children }: { children: ReactNode }) {
  // Audit reviewers may enter the segment only for the audit log; each other page re-checks
  // PLATFORM_ADMIN_ROLES (a layout does not re-render on soft navigation between sibling routes).
  requireAnyRole([...PLATFORM_ADMIN_ROLES, ...PLATFORM_AUDIT_VIEW_ROLES], "/dashboard");
  return <>{children}</>;
}
