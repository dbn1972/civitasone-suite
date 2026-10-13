import type { ReactNode } from "react";
import { ModuleGate } from "../ModuleGate";
import { requireAnyRole } from "@/lib/auth/roleGuard";
import { ADMIN_TENANT_ROLES } from "@/lib/auth/adminRoles";

/**
 * SF-20: Change & Release reads and writes admin-service /v1/admin/change/*, where every route
 * calls requireRole(ctx, CHANGE_ROLES) and CHANGE_ROLES = TENANT_ADMIN_ROLES (tenant_admin,
 * super_admin, platform_admin), the same set as ADMIN_TENANT_ROLES.
 */
export default function ChangeLayout({ children }: { children: ReactNode }) {
  requireAnyRole([...ADMIN_TENANT_ROLES]);
  return <ModuleGate moduleKey="admin">{children}</ModuleGate>;
}
