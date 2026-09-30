/**
 * GAP-HR-EMPLOYEES-DETAIL-06: web-side mirror of hrms-service's
 * employee/status.ts (services/hrms-service/src/modules/employee/
 * status.ts) -- apps/web cannot import across the service boundary
 * (CLAUDE.md module-isolation rule), so this is a small, deliberately
 * kept-in-sync copy of just the two sets the web layer needs. The
 * backend's own comments there explain *why* each status is bucketed
 * where it is; read that file before changing this one.
 */

export const SERVING_STATUSES: ReadonlySet<string> = new Set([
  "probation",
  "confirmed",
  "deputation",
]);

export const EXITED_STATUSES: ReadonlySet<string> = new Set([
  "terminated",
  "separated",
  "retired",
]);

export function isServingStatus(status: string | undefined | null): boolean {
  return !!status && SERVING_STATUSES.has(status);
}

export function isExitedStatus(status: string | undefined | null): boolean {
  return !!status && EXITED_STATUSES.has(status);
}
