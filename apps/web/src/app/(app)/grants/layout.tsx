import type { ReactNode } from "react";
import { getSessionRoles, hasAnyRole } from "@/lib/auth/roleGuard";
import { PermissionDenied } from "../../_components/PermissionDenied";
import { GRANTS_VIEW_ROLES } from "./roles";
import { ModuleGate } from "../ModuleGate";

/**
 * GAP-GRANTS-DETAIL-01 / DISBURSEMENTS-DETAIL-01 / APPLICATIONS-DETAIL-01:
 * the grants tree previously had NO role gate — only ModuleGate (tenant
 * enablement) — so every signed-in user who could open the module reached the
 * maker/approver controls. A session with no grants role now gets an honest
 * PermissionDenied screen (not a silent bounce to /dashboard), mirroring
 * loyalty/layout.tsx. grant-service still enforces the same roles on every
 * route (requireRole); this is defence-in-depth + UX.
 */
export default function GrantsLayout({ children }: { children: ReactNode }) {
  if (!hasAnyRole(getSessionRoles(), GRANTS_VIEW_ROLES)) {
    return <PermissionDenied backHref="/dashboard" />;
  }
  return <ModuleGate moduleKey="grants">{children}</ModuleGate>;
}
