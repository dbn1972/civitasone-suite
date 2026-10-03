/** GAP-FINANCE-DASHBOARD-06: BFF proxy URL of the finance-service MIS CSV export for a fiscal year. */
export function misExportHref(fy: string): string {
  return `/api/proxy/v1/finance/dashboard/mis-export?fy=${encodeURIComponent(fy)}`;
}
