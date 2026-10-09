/**
 * Canonical analytics-service role vocabulary.
 *
 * GAP2-ANALYTICS-ROLES-01: before this module the service had no consistent
 * "reader" role. KPI / data-warehouse / ai-insights and exports gated on
 * `analytics_viewer`, while dashboards / queries / metrics / stream gated on
 * `analytics_user` — and the two names never overlapped. A user holding
 * `analytics_user` (accepted by Dashboards/Queries) was therefore 403'd the
 * moment they opened the KPI, Data Warehouse, AI Insights or Exports tiles
 * the same hub advertises.
 *
 * The fix is a single reader vocabulary applied uniformly across every
 * analytics READ route. We take the UNION of the two historical names
 * (`analytics_user` + `analytics_viewer`) so neither an existing
 * `analytics_user` nor an existing `analytics_viewer` principal loses access,
 * plus the admin/platform roles both sets already carried. The web mirrors
 * this set in a roleGuard constant (ANALYTICS_READER_ROLES) and gates the
 * analytics layout so an unauthorised user sees PermissionDenied rather than
 * four failed fetches.
 */
export const ANALYTICS_READ_ROLES = [
  "analytics_user",
  "analytics_viewer",
  "analytics_admin",
  "tenant_admin",
  "super_admin",
  "platform_admin",
];

/**
 * Roles permitted to MUTATE analytics objects (create/update dashboards,
 * save metrics, run queries, create exports). Narrower than the reader set —
 * a read-only `analytics_viewer` must not be able to write. Mirrors the
 * historical write set used by dashboards/queries/metrics.
 */
export const ANALYTICS_WRITE_ROLES = [
  "analytics_user",
  "analytics_admin",
  "report_admin",
  "tenant_admin",
  "super_admin",
];
