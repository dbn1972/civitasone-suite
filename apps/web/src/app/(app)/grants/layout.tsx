import type { ReactNode } from "react";
import { requireAnyRole } from "@/lib/auth/roleGuard";
import { GRANTS_VIEW_ROLES } from "./roles";
import { ModuleGate } from "../ModuleGate";

/**
 * GAP-GRANTS-DETAIL-01 / DISBURSEMENTS-DETAIL-01 / APPLICATIONS-DETAIL-01:
 * the grants tree previously had NO role gate — only ModuleGate (tenant
 * enablement) — so every signed-in user who could open the module reached the
 * maker/approver controls. requireAnyRole redirects a session with no grants
 * role to /dashboard, mirroring crm/layout.tsx. grant-service still enforces
 * the same roles on every route (requireRole); this is defence-in-depth + UX.
 */
export default function GrantsLayout({ children }: { children: ReactNode }) {
  requireAnyRole(GRANTS_VIEW_ROLES);
  return <ModuleGate moduleKey="grants">{children}</ModuleGate>;
}
