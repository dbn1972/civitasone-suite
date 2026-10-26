import type { ReactNode } from "react";
import { requireAnyRole } from "@/lib/auth/roleGuard";
import { getRequestPathname } from "@/lib/auth/requestPath";
import { adminAreaRoles } from "../tenant/_routeRoles";

// Single source of truth shared with tenant/layout.tsx so the /tenant ->
// /tenant-admin org-hierarchy redirect can never send a role to a page that
// bounces it (GAP-TENANT-ORG-HIERARCHY-01).
export default function TenantAdminLayout({ children }: { children: ReactNode }) {
  requireAnyRole(adminAreaRoles(getRequestPathname()));
  return <>{children}</>;
}
