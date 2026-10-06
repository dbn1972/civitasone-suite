import type { ReactNode } from "react";
import { getSessionRoles } from "@/lib/auth/roleGuard";
import { REVENUE_ROLES } from "@/lib/auth/workRoles";
import { PermissionDenied } from "@/app/_components/PermissionDenied";
import { ModuleGate } from "../ModuleGate";

/**
 * Revenue module gate (GAP-REVENUE-HOME-01, GAP-REVENUE-ASSESSEES-DETAIL-02).
 *
 * Before this, /revenue had no layout and no role/module gate: the sidebar hid
 * the entry via moduleKey "revenue", but any signed-in user could open any
 * /revenue/* URL by typing it and read assessee financial + PII data. This is
 * the honest client-side counterpart to revenue-service's own route guards
 * (collection/routes.ts REVENUE_ROLES, analytics/routes.ts READ_ROLES — the
 * server already 403s a role with no revenue permission): a user with NONE of
 * REVENUE_ROLES gets the same "access restricted" treatment on direct
 * navigation, not a silent blank or a misleading "couldn't load".
 *
 * Fails OPEN (renders normally) when roles can't be determined at all (empty
 * roles array), matching Sidebar.tsx / moduleVisibility.ts "unknown -> show
 * all". This layer is advisory; the backend enforces the real boundary.
 */
export default function RevenueLayout({ children }: { children: ReactNode }) {
	const roles = getSessionRoles();
	const hasRevenuePermission =
		roles.length === 0 || roles.some((r) => (REVENUE_ROLES as readonly string[]).includes(r));

	if (!hasRevenuePermission) {
		return <PermissionDenied module="revenue" requiredRoles={[...REVENUE_ROLES]} />;
	}

	return <ModuleGate moduleKey="revenue">{children}</ModuleGate>;
}
