import type { ReactNode } from "react";
import { requireAnyRole } from "@/lib/auth/roleGuard";
import { POLICY_ADMIN_ROLES } from "@/lib/auth/roleGuard";

/**
 * GAP-POLICY-HOME-01 / GAP-POLICY-BINDINGS-01: the /policy segment edits
 * authorisation (role bindings, ABAC rules, role-feature visibility), so it
 * must not be reachable by any signed-in user. This layout gates the whole
 * segment on the policy-admin role set — the same set every policy-service
 * route enforces server-side (that remains the authority; this is
 * defence-in-depth and avoids showing controls that would only 403).
 */
export default function PolicyLayout({ children }: { children: ReactNode }) {
  requireAnyRole(POLICY_ADMIN_ROLES);
  return <>{children}</>;
}
