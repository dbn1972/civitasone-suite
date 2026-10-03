type Row = Record<string, unknown>;

export type TenantSummary = { total: number | null; active: number | null; trial: number | null; suspended: number | null };

/**
 * GAP-ADMIN-TENANTS-03: tiles are computed from the rows the table shows
 * (a cached copy included), never from a separate server read that can be
 * empty while the table is not. `unavailable` (failed load, nothing cached)
 * yields nulls so StatCard shows a dash instead of 0.
 */
export function summariseTenants(rows: readonly Row[], unavailable: boolean): TenantSummary {
  if (unavailable) return { total: null, active: null, trial: null, suspended: null };
  const n = (status: string) => rows.filter((t) => String(t.status ?? "").toLowerCase() === status).length;
  return { total: rows.length, active: n("active"), trial: n("trial"), suspended: n("suspended") };
}
