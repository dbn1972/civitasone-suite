import type { ReactNode } from "react";
import { ModuleGate } from "../ModuleGate";
import { requireAnyRole } from "@/lib/auth/roleGuard";
import { ADMIN_CONSOLE_ROLES } from "@/lib/auth/adminRoles";

/**
 * SF-20: gate the whole /admin console. Before this layout a signed-in user with no admin role
 * reached the 40 admin pages by URL and only the per-page gates (12 of 40 had one) stopped them.
 * The floor is ADMIN_CONSOLE_ROLES, the union of the lists the pages use (see adminRoles.ts); each
 * page still applies its own, narrower list, because a layout does not re-run on soft navigation
 * between sibling routes. admin-service is a platform module, so ModuleGate never hides it.
 */
export default function AdminLayout({ children }: { children: ReactNode }) {
  requireAnyRole([...ADMIN_CONSOLE_ROLES]);
  return <ModuleGate moduleKey="admin">{children}</ModuleGate>;
}
