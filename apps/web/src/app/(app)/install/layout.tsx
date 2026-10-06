import type { ReactNode } from "react";
import { requireAnyRole } from "@/lib/auth/roleGuard";
import { INSTALL_VIEW_ROLES } from "@/lib/auth/roleGuard";

/**
 * GAP-INSTALL-HOME-03 / GAP-INSTALL-DOMAIN-PACKS-01 / GAP-INSTALL-SILOS-04:
 * segment gate for the whole /install area (wizard, stages, steps, modules,
 * silo provisions, Domain Pack activation). These pages run and inspect tenant
 * provisioning, so a viewer outside INSTALL_VIEW_ROLES is redirected to the
 * dashboard rather than shown provisioning state / mutation controls. The
 * install-service enforces the SAME role set on every route (requireRole),
 * so this is defence-in-depth, not the sole control.
 */
export default function InstallLayout({ children }: { children: ReactNode }) {
  requireAnyRole(INSTALL_VIEW_ROLES);
  return <>{children}</>;
}
