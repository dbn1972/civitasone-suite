import type { ReactNode } from "react";
import { getSessionRoles } from "@/lib/auth/roleGuard";
import { FINANCE_ROLES } from "@/lib/auth/workRoles";
import { PermissionDenied } from "@/app/_components/PermissionDenied";
import { ModuleGate } from "../ModuleGate";

/**
 * UX gate (Medium finding): every /finance/* screen rendered for every role
 * regardless of permission, even though the server-side boundary already
 * holds -- finance-service 403s a role with no finance permission on every
 * one of its endpoints already. This is purely the honest client-side
 * counterpart: a role with NO finance permission at all gets the same
 * "access restricted" treatment here, on direct navigation to any
 * /finance/* URL, that a live 403 gets elsewhere via LoadErrorState (PR
 * #1562) -- not a generic "couldn't load, try again" error, and not a
 * silent redirect that hides *why*. See FINANCE_ROLES's own doc comment
 * (lib/auth/workRoles.ts) for how that list was derived from
 * finance-service's own route guards. Sidebar.tsx hides the "Finance" nav
 * entry for the same roles, so this fallback is normally only reached via a
 * stale bookmark or a typed-in URL, not the app's own nav.
 *
 * Fails OPEN (renders normally) when roles can't be determined at all
 * (empty roles array) -- matching moduleVisibility.ts/Sidebar.tsx's own
 * "unknown -> show all" convention. This layer is advisory, never the only
 * boundary: the backend enforces the real one regardless.
 */
export default function FinanceLayout({ children }: { children: ReactNode }) {
  const roles = getSessionRoles();
  const hasFinancePermission =
    roles.length === 0 || roles.some((r) => (FINANCE_ROLES as readonly string[]).includes(r));

  if (!hasFinancePermission) {
    return <PermissionDenied module="finance" requiredRoles={[...FINANCE_ROLES]} />;
  }

  return <ModuleGate moduleKey="finance">{children}</ModuleGate>;
}
