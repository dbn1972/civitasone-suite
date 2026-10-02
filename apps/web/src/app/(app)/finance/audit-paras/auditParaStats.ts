/**
 * GAP-FINANCE-AUDIT-PARAS-02: headline counts derived from the SAME rows the
 * table renders (so cards and rows share provenance). Valid statuses are the
 * DB CHECK's open|responded|settled|escalated|dropped (audit/routes.ts).
 */
export interface AuditParaStatRow {
  status: string;
}

export function auditParaStats(rows: readonly AuditParaStatRow[]) {
  const count = (s: string) => rows.filter((p) => String(p.status).toLowerCase() === s).length;
  return {
    total: rows.length,
    open: count("open"),
    responded: count("responded"),
    settled: count("settled"),
  };
}
