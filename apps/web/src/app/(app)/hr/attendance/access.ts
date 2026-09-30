import type { AttendanceSummaryItem } from "@civitasone/types";

/**
 * Mirrors services/hrms-service/src/modules/attendance/routes.ts's own
 * ALL_ROLES for GET /v1/hrms/attendance and GET .../regularisations
 * (hr_admin, hr_officer, super_admin, manager). hr/layout.tsx's own
 * HR_ROLES additionally admits "employee" (plus payroll_officer,
 * payroll_admin, tenant_admin, platform_admin) so those roles can reach
 * self-service pages under /hr --
 * but a plain employee reaching THIS page used to trigger the records fetch
 * anyway, get 403'd by the backend, and see a fabricated 0-stat error badge
 * instead of just the self-service check-in card they have a legitimate use
 * for (GAP-HR-ATTENDANCE-03 / GAP-HR-ATTENDANCE-REGULARISATION-02).
 *
 * Kept here (not re-declared per page) so both /hr/attendance and
 * /hr/attendance/regularisation can't drift apart on who can view records --
 * the systemic "duplicated role arrays" risk the catalog itself flags on
 * several of these items.
 */
export const ATTENDANCE_VIEW_ROLES = ["hr_admin", "hr_officer", "super_admin", "manager"];

export function canViewAttendanceRecords(roles: string[]): boolean {
  return roles.some((r) => ATTENDANCE_VIEW_ROLES.includes(r));
}

/**
 * Same tier as attendance/config/page.tsx's own (separately declared)
 * ATTENDANCE_CONFIG_ROLES -- kept as two small, independent copies rather
 * than one shared import so this PR and the config-module PR stay
 * independently mergeable/revertable in either order; if that ever drifts,
 * tests/contract/hr-role-matrix.contract.test.ts's allowlist is the place to
 * reconcile it, same as every other duplicated role list this catalog
 * flags. Used by AttendanceTable's emptyAction: only hr_admin/super_admin
 * can reach the read-only attendance-rules reference page, so only they
 * should see a link to it (GAP-HR-ATTENDANCE-04).
 */
export const ATTENDANCE_CONFIG_ROLES = ["hr_admin", "super_admin"];

export function canConfigureAttendance(roles: string[]): boolean {
  return roles.some((r) => ATTENDANCE_CONFIG_ROLES.includes(r));
}

export interface AttendanceStats {
  total: number | null;
  present: number | null;
  absent: number | null;
  onLeave: number | null;
}

/**
 * GAP-HR-ATTENDANCE-02: stats used to count over the loader's `[]` error
 * fallback, so a fetch failure showed a genuine-looking 0/0/0/0 instead of
 * signaling "unknown" -- sibling pages (checkin-log, apar) already use this
 * errored ? null/dash convention; this mirrors apar/page.tsx's `null` choice
 * (StatCard already renders null as a dash).
 */
export function computeAttendanceStats(records: AttendanceSummaryItem[], errored: boolean): AttendanceStats {
  if (errored) {
    return { total: null, present: null, absent: null, onLeave: null };
  }
  return {
    total: records.length,
    present: records.filter((r) => r.status === "present").length,
    absent: records.filter((r) => r.status === "absent").length,
    onLeave: records.filter((r) => r.status === "on_leave").length,
  };
}
