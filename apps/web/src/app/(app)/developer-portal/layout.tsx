import type { ReactNode } from "react";
import { requireAnyRole } from "@/lib/auth/roleGuard";

/**
 * GAP-DEVELOPER-PORTAL-HOME-04 (ROLEGATE): the Developer Portal home surfaces
 * API-key metadata (key names and non-secret key prefixes) read from the
 * admin-service endpoint `/api/v1/admin/api-keys`, which is admin-only. The
 * segment previously had no layout, so any authenticated user with the module
 * in their nav could open it and read that credential metadata.
 *
 * DECISION (safest default, flagged for HUMAN REVIEW): gate the whole segment
 * to the same roles the sibling API-key *management* surface uses
 * (tenant-admin/layout.tsx: tenant_admin, platform_admin, super_admin). The
 * admin-service remains the authority — a non-admin's GET already 403s — so
 * this web gate is defence-in-depth plus an honest redirect instead of a
 * failed fetch rendered as an empty tenant. If product decides plain
 * developers (non-admins) should reach a credential-free view, split the keys
 * card out behind this same check and leave the capability grid public.
 */
const ALLOWED = ["tenant_admin", "platform_admin", "super_admin"];

export default function DeveloperPortalLayout({ children }: { children: ReactNode }) {
  requireAnyRole(ALLOWED);
  return <>{children}</>;
}
