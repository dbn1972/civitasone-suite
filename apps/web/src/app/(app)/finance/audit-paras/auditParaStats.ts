/**
 * GAP-FINANCE-AUDIT-PARAS-02/03: headline counts derived from the SAME rows the
 * table renders (so cards and rows share provenance). Valid statuses are the
 * DB CHECK's open|responded|settled|escalated|dropped (audit/routes.ts); any
 * unknown status is bucketed with "dropped" as `droppedOther`, so the buckets
 * always sum to `total`.
 */
export interface AuditParaStatRow {
  status: string;
}

export function auditParaStats(rows: readonly AuditParaStatRow[]) {
  const count = (s: string) => rows.filter((p) => String(p.status).trim().toLowerCase() === s).length;
  const open = count("open");
  const responded = count("responded");
  const settled = count("settled");
  const escalated = count("escalated");
  return {
    total: rows.length,
    open,
    responded,
    settled,
    escalated,
    /** dropped + any status this UI does not know */
    droppedOther: rows.length - open - responded - settled - escalated,
  };
}
