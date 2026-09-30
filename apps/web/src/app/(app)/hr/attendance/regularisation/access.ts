import type { AttendanceRegularisation } from "@civitasone/types";

/**
 * GAP-HR-ATTENDANCE-REGULARISATION-02: mirrors
 * services/hrms-service/src/modules/attendance/routes.ts's own ALL_ROLES
 * for GET /v1/hrms/attendance/regularisations (hr_admin, hr_officer,
 * super_admin, manager). hr/layout.tsx's HR_ROLES additionally admits
 * "employee" (plus payroll_officer, payroll_admin, tenant_admin,
 * platform_admin), so those roles used to reach this page, get 403'd by
 * the backend, and see a fabricated
 * 0-stat error badge with no page-level role gate at all (unlike
 * attendance/config/page.tsx, which already has one).
 *
 * Kept local to this folder rather than imported from
 * hr/attendance/access.ts (a separate, sibling fix in this same campaign)
 * so the two PRs stay independently mergeable in either order -- see that
 * file's own comment on the same tradeoff.
 */
export const REGULARISATION_VIEW_ROLES = ["hr_admin", "hr_officer", "super_admin", "manager"];

export function canViewRegularisations(roles: string[]): boolean {
  return roles.some((r) => REGULARISATION_VIEW_ROLES.includes(r));
}

export interface RegularisationStats {
  total: number | null;
  pending: number | null;
  approved: number | null;
  rejected: number | null;
}

/**
 * GAP-HR-ATTENDANCE-REGULARISATION-04: stats used to count over the
 * loader's `[]` error fallback (a genuine-looking 0/0/0/0 on fetch
 * failure) -- mirrors checkin-log/page.tsx's errored ? "—" : n and
 * apar/page.tsx's errored ? null : n conventions (this one follows apar's
 * `null` choice, since StatCard already renders null as a dash).
 */
export function computeRegularisationStats(regs: AttendanceRegularisation[], errored: boolean): RegularisationStats {
  if (errored) {
    return { total: null, pending: null, approved: null, rejected: null };
  }
  return {
    total: regs.length,
    pending: regs.filter((r) => r.status === "pending").length,
    approved: regs.filter((r) => r.status === "approved").length,
    rejected: regs.filter((r) => r.status === "rejected").length,
  };
}
