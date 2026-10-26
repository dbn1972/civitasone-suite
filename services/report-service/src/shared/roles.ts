/**
 * Canonical report-service role vocabulary.
 *
 * GAP2-REPORTS-ROLES-01: the report-service modules disagreed on the report
 * role vocabulary. Jobs, KPIs, MIS and the dashboard routes accepted
 * `report_user`; the scheduled-reports routes accepted `report_viewer`
 * (plus finance_admin/admin/tenant_admin) but NOT `report_user`. So a
 * `report_user` could build report jobs but was 403'd creating/listing
 * scheduled reports, while a `report_viewer` was 403'd on jobs — on the same
 * Reports hub, with no web-side signal.
 *
 * Reconciled to a single READ set and a single WRITE set applied across
 * jobs / kpis / mis / dashboard / scheduled. We take the UNION of the two
 * historical reader names (`report_user` + `report_viewer`) plus the admin/
 * finance/tenant roles the scheduled routes already carried, so no existing
 * principal loses access. The web mirrors this in REPORTS_READER_ROLES and
 * gates the /reports layout.
 */
export const REPORT_READ_ROLES = [
  "report_user",
  "report_viewer",
  "report_admin",
  "finance_admin",
  "admin",
  "tenant_admin",
  "super_admin",
];

/**
 * Roles permitted to MUTATE report objects (create a report job, create /
 * update / disable / run a scheduled report). report_viewer is READ-ONLY and is
 * deliberately NOT here: a scheduled report emails up to 20 external
 * recipients, so a read-only viewer must never create, patch, run or delete one.
 */
export const REPORT_WRITE_ROLES = [
  "report_user",
  "report_admin",
  "finance_admin",
  "admin",
  "tenant_admin",
  "super_admin",
];

/** Create / share a report JOB (same set as REPORT_WRITE_ROLES). */
export const REPORT_JOB_WRITE_ROLES = REPORT_WRITE_ROLES;

/**
 * Roles with TENANT-WIDE visibility over report jobs and scheduled reports.
 * Everyone else (report_user, report_viewer) sees and acts on only the rows
 * they created. Legacy rows with a null requested_by are admin-visible only.
 */
export const REPORT_ADMIN_ROLES = ["report_admin", "finance_admin", "admin", "tenant_admin", "super_admin"];

/**
 * UAT owner decision #17: ONLY report_admin may export PII columns unmasked, and
 * only with a recorded reason. No other admin role (finance_admin, tenant_admin,
 * admin, super_admin) is enough.
 */
export const REPORT_PII_UNMASK_ROLES = ["report_admin"];

export function isReportAdmin(ctx: { roles: readonly string[] }): boolean {
  return ctx.roles.some((r) => REPORT_ADMIN_ROLES.includes(r));
}

/** Owner filter for a request: undefined = tenant-wide (admin), else the actor id. */
export function ownerScope(ctx: { roles: readonly string[]; actorId: string }): string | undefined {
  return isReportAdmin(ctx) ? undefined : ctx.actorId;
}
