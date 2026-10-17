import type { ReactNode } from "react";
import { requireAnyRole } from "@/lib/auth/roleGuard";
import { TENANT_ADMIN_ROLES } from "../tenant/_roles";

// Single source of truth shared with tenant/layout.tsx so the /tenant ->
// /tenant-admin org-hierarchy redirect can never send a role to a page that
// bounces it (GAP-TENANT-ORG-HIERARCHY-01).
const ALLOWED = TENANT_ADMIN_ROLES;

export default function TenantAdminLayout({ children }: { children: ReactNode }) {
  requireAnyRole(ALLOWED);
  return <>{children}</>;
}
