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
 * update / disable / run a scheduled report). Includes both historical reader
 * names that the respective write surfaces accepted before the fix
 * (jobs accepted `report_user`; scheduled accepted `report_viewer`), unioned
 * so neither flow regresses, plus the admin/finance/tenant roles.
 */
export const REPORT_WRITE_ROLES = [
  "report_user",
  "report_viewer",
  "report_admin",
  "finance_admin",
  "admin",
  "tenant_admin",
  "super_admin",
];

/**
 * Roles permitted to create or share a report JOB (POST /v1/reports/jobs and
 * /jobs/:id/share). Deliberately excludes the read-only report_viewer role:
 * sharing sends a report to arbitrary recipients, which a viewer must never
 * do. Scheduled-report mutation keeps REPORT_WRITE_ROLES (which still admits
 * report_viewer) for backward compatibility.
 */
export const REPORT_JOB_WRITE_ROLES = REPORT_WRITE_ROLES.filter((r) => r !== "report_viewer");
