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

/**
 * Pill colour override for the employee's OWN status. The shared StatusPill
 * map keys on the humanized text, and "on leave" there is deliberately the
 * calm blue of an approved attendance absence; an employee whose status is
 * on_leave is a state HR should notice (their lifecycle actions are withheld),
 * so it reads as a warning on the profile. Everything else keeps the shared
 * mapping (suspended / no_show bad, separated muted, deputation info, ...).
 */
export function employeeStatusVariant(status: string | undefined | null): "warn" | undefined {
  return status === "on_leave" ? "warn" : undefined;
}
