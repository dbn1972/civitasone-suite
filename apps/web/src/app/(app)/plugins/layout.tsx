import type { ReactNode } from "react";
import { requireAnyRole, PLUGIN_MODULE_ROLES } from "@/lib/auth/roleGuard";

/**
 * GAP-PLUGINS-HOME-01 / GAP-PLUGINS-INSTALLED-02 (theme ROLEGATE): the whole
 * /plugins module installs, enables and disables tenant-wide plugins, yet it
 * had no layout gate — every signed-in user reached the tiles and the Installed
 * controls. This segment gate admits only the plugin roles (union of everyone a
 * plugin sub-route would admit) and redirects everyone else to the dashboard.
 * The plugin-service remains the authoritative gate (every route calls
 * requireRole); this is defence-in-depth + honest UX. The Installed page
 * additionally hides the mutating controls from non-managers (PLUGIN_MANAGE_ROLES).
 */
export default function PluginsLayout({ children }: { children: ReactNode }) {
  requireAnyRole(PLUGIN_MODULE_ROLES, "/dashboard");
  return <>{children}</>;
}
