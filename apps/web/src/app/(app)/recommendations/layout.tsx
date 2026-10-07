import type { ReactNode } from "react";
import { ModuleGate } from "../ModuleGate";
import { PermissionDenied } from "@/app/_components/PermissionDenied";
import { getSessionRoles, hasAnyRole, RECOMMENDATION_READER_ROLES } from "@/lib/auth/roleGuard";

export default function Layout({ children }: { children: ReactNode }) {
  // GAP-RECOMMENDATIONS-HEALTH-02: the route was gated only by the tenant
  // module flag (ModuleGate), not by role, so any role the tenant admitted
  // could open the at-risk/CRM-level surfaces. recommendation-service already
  // enforces RBAC (REC_ROLES) and returns 403; this web gate matches it so a
  // user without a recommendation role sees PermissionDenied instead of four
  // failed fetches. The server stays the authority.
  if (!hasAnyRole(getSessionRoles(), RECOMMENDATION_READER_ROLES)) {
    return <PermissionDenied backHref="/dashboard" />;
  }
  return <ModuleGate moduleKey="recommendation">{children}</ModuleGate>;
}
