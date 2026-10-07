import type { ReactNode } from "react";
import { ModuleGate } from "../ModuleGate";
import { getSessionRoles, hasAnyRole, LOYALTY_READ_ROLES } from "@/lib/auth/roleGuard";
import { PermissionDenied } from "../../_components/PermissionDenied";

/**
 * GAP-LOYALTY-ACCRUALS-02 / MEMBERS-02 / HOME-03: loyalty routes expose member
 * references, point balances and redemption history. The layout previously
 * only applied ModuleGate (is the module enabled for the tenant) with NO role
 * check, so any signed-in user whose role lacked loyalty access saw an
 * unexplained failed fetch instead of an honest "access restricted" screen.
 * loyalty-service enforces LOYALTY_READ_ROLES on every GET; this web gate is
 * defence-in-depth and honest UX. The server remains the authority.
 */
export default function Layout({ children }: { children: ReactNode }) {
  const roles = getSessionRoles();
  if (!hasAnyRole(roles, LOYALTY_READ_ROLES)) {
    return <PermissionDenied />;
  }
  return <ModuleGate moduleKey="loyalty">{children}</ModuleGate>;
}
