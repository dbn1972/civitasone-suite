import { requireAnyRole, ESTAB_OPERATOR_ADMIN_ROLES } from "@/lib/auth/roleGuard";

/**
 * GAP-ESTAB-HANDOVER-02: bulk charge handover is admin-only — the backend
 * requires estab_division_admin | estab_admin | super_admin on POST
 * /v1/estab/handovers. This layout mirrors that gate on the web side so a
 * plain estab_officer never sees the form (defence-in-depth, not sole control).
 */
export default function HandoverLayout({ children }: { children: React.ReactNode }) {
  requireAnyRole(ESTAB_OPERATOR_ADMIN_ROLES, "/estab");
  return <>{children}</>;
}
