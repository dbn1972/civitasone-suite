/**
 * GAP-HR-OVERTIME-04: fold the grouped (status, count, summed hours) rows of
 * the overtime list's aggregate query into the response `summary`. The
 * approved-hours figure is rounded to hundredths so it never carries float
 * drift (same two-decimal convention the web list already used per row).
 */
export function summariseOvertimeByStatus(
  rows: ReadonlyArray<{ status: string; n: number | string; hours: string | number | null }>,
): { total: number; pending: number; approved: number; rejected: number; approvedHours: number } {
  const out = { total: 0, pending: 0, approved: 0, rejected: 0, approvedHours: 0 };
  for (const r of rows) {
    const n = Number(r.n);
    out.total += n;
    if (r.status === "pending") out.pending += n;
    else if (r.status === "approved") {
      out.approved += n;
      out.approvedHours = Math.round(Number(r.hours ?? 0) * 100) / 100;
    } else if (r.status === "rejected") out.rejected += n;
  }
  return out;
}
