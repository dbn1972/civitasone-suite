import type { ReactNode } from "react";
import { requireAnyRole } from "@/lib/auth/roleGuard";
import { IDENTITY_ADMIN_ROLES } from "@/lib/auth/identityRoles";
import { ModuleGate } from "../ModuleGate";

/**
 * GAP-IDENTITY-{SESSIONS,USERS,WEBAUTHN,API-KEYS,BREAKGLASS}-01: gate the whole
 * /identity administration surface on an admin role BEFORE the module-enablement
 * check, exactly as hr/layout.tsx and tenant-admin/layout.tsx do. Previously
 * this layout rendered only <ModuleGate>, so any signed-in tenant user reached
 * the user directory, active sessions (IP / user-agent), break-glass reasons and
 * API keys. See lib/auth/identityRoles.ts for the role-set decision. The backend
 * identity-service independently enforces the same roles on /identity/* (see its
 * apikeys/breakglass routes' ADMIN list); this is defence-in-depth + honest UX.
 */
export default function Layout({ children }: { children: ReactNode }) {
  requireAnyRole(IDENTITY_ADMIN_ROLES);
  return <ModuleGate moduleKey="identity">{children}</ModuleGate>;
}
