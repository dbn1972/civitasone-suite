import type { ReactNode } from "react";
import { ModuleGate } from "../ModuleGate";
import { requireAnyRole, THEME_MODULE_ROLES } from "@/lib/auth/roleGuard";

/**
 * GAP-THEMES-HOME-01 / GAP-THEMES-TOKENS-02 / GAP-THEMES-BRAND-05 /
 * GAP-THEMES-BRANDING-05 / GAP-THEMES-TEMPLATES-04: the /themes tree had no
 * layout gate, so middleware's session-only check let any signed-in user reach
 * the hub and the tenant-wide Publish control. theme-service enforces roles on
 * every route server-side (verified), but the web layer advertised the controls
 * regardless. This mirrors the server's union set (THEME_MODULE_ROLES) so an
 * unauthorised user is redirected to /dashboard instead of being shown doomed
 * controls; the server remains the real authority. The narrower admin set
 * (THEME_ADMIN_ROLES) additionally gates the publish/edit tiles on the hub.
 */
export default function ThemesLayout({ children }: { children: ReactNode }) {
  requireAnyRole(THEME_MODULE_ROLES);
  return <ModuleGate moduleKey="themes">{children}</ModuleGate>;
}
