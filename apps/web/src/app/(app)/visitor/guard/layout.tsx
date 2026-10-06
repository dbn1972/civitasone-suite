import type { ReactNode } from "react";
import { requireAnyRole, VISITOR_GUARD_ROLES } from "@/lib/auth/roleGuard";

/**
 * GAP-VISITOR-HOME-02: the guard console performs gate verification and
 * check-in/out and reads the live occupancy roster. visitor-service already
 * enforces ACTIVE_ROLES/GATE_ROLES/WRITE_ROLES on those endpoints (the
 * authority); this gate is defence-in-depth and honest UX. A user without a
 * guard-capable role is sent back to the visitor hub.
 */
export default function VisitorGuardLayout({ children }: { children: ReactNode }) {
  requireAnyRole(VISITOR_GUARD_ROLES, "/visitor");
  return <>{children}</>;
}
