import type { ReactNode } from "react";
import { requireAnyRole, VISITOR_ADMIN_ROLES } from "@/lib/auth/roleGuard";

/**
 * GAP-VISITOR-ADMIN-02 / GAP-VISITOR-HOME-02: visitor policy configuration
 * changes tenant-wide retention/approval/overstay/pass rules, so the segment
 * is restricted to visitor admins. The visitor-service config-registry routes
 * already enforce the same CONFIG_WRITE_ROLES server-side (the authority);
 * this gate is defence-in-depth and avoids showing a page whose every write
 * is guaranteed to 403. A non-admin is sent back to the visitor hub.
 */
export default function VisitorAdminLayout({ children }: { children: ReactNode }) {
  requireAnyRole(VISITOR_ADMIN_ROLES, "/visitor");
  return <>{children}</>;
}
