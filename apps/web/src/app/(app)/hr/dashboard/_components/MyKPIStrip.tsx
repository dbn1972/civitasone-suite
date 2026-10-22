interface Props {
  // null/undefined = the underlying loader failed (honest-blank), not a
  // genuine zero -- same hasValue() convention as HRKPIStrip.tsx, so a
  // failed self-service fetch never fabricates a "0 days left"/"all clear".
  leaveBalanceDays: number | null | undefined;
  pendingCount: number | null | undefined;
  routingFailedCount: number | null | undefined;
  attendanceThisMonthPct: number | null | undefined;
  employmentStatusLabel: string | null | undefined;
}

function hasValue(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function displayCount(value: number | null | undefined): string {
  return hasValue(value) ? value.toLocaleString("en-IN") : "—";
}

/**
 * Employee-role counterpart to HRKPIStrip.tsx. Deliberately a SEPARATE
 * component, not a reuse/extension of HRKPIStrip: the two show unrelated
 * metrics (this employee's own leave/attendance vs. org-wide headcount) and
 * HRKPIStrip's props/tests are org-wide-KPI-shaped — bolting self-service
 * fields onto it would make both halves harder to reason about for no
 * shared benefit. See hr/dashboard/page.tsx: only ONE of these two strips
 * renders per request, gated on whether the viewer holds any of
 * getHRDashboard()'s READER_ROLES.
 */
export function MyKPIStrip({
  leaveBalanceDays, pendingCount, routingFailedCount, attendanceThisMonthPct, employmentStatusLabel,
}: Props) {
  const hasRoutingFailure = hasValue(routingFailedCount) && routingFailedCount > 0;

  return (
    <div className="my-kpi-strip" role="list">
      <div className="my-kpi-card my-kpi-blue" role="listitem">
        <div className="my-kpi-label">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--info)" strokeWidth="2" aria-hidden="true"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
          Leave Balance
        </div>
        <div className="my-kpi-val">{hasValue(leaveBalanceDays) ? leaveBalanceDays.toLocaleString("en-IN") : "—"}</div>
        <div className="my-kpi-trend">{hasValue(leaveBalanceDays) ? "days available" : "No data"}</div>
      </div>

      <div className={`my-kpi-card ${hasRoutingFailure ? "my-kpi-red" : "my-kpi-amber"}`} role="listitem" style={{ position: "relative" }}>
        {hasValue(pendingCount) && pendingCount > 0 && (
          <span className="my-kpi-badge" role="status" aria-label={`${pendingCount} pending`}>{pendingCount}</span>
        )}
        <div className="my-kpi-label">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={hasRoutingFailure ? "var(--bad)" : "var(--warn)"} strokeWidth="2" aria-hidden="true"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          My Requests
        </div>
        <div className="my-kpi-val">{displayCount(pendingCount)}</div>
        <div className={`my-kpi-trend ${hasRoutingFailure ? "trend-urgent" : ""}`}>
          {!hasValue(pendingCount)
            ? "No data"
            : hasRoutingFailure
            ? `⚠ ${routingFailedCount} need${routingFailedCount === 1 ? "s" : ""} attention`
            : pendingCount > 0 ? "awaiting approval" : "nothing pending"}
        </div>
      </div>

      <div className="my-kpi-card my-kpi-slate" role="listitem">
        <div className="my-kpi-label">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--mut)" strokeWidth="2" aria-hidden="true"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
          Attendance This Month
        </div>
        {!hasValue(attendanceThisMonthPct) ? (
          <>
            <div className="my-kpi-val my-kpi-val-muted">—</div>
            <div className="my-kpi-trend">No data</div>
          </>
        ) : (
          <>
            <div className="my-kpi-val">{attendanceThisMonthPct}%</div>
            <div className="my-kpi-trend trend-up">present</div>
          </>
        )}
      </div>

      <div className="my-kpi-card my-kpi-slate" role="listitem">
        <div className="my-kpi-label">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--mut)" strokeWidth="2" aria-hidden="true"><path d="M20 6L9 17l-5-5"/></svg>
          Employment Status
        </div>
        <div className="my-kpi-val my-kpi-val-sm">{employmentStatusLabel ?? "—"}</div>
        <div className="my-kpi-trend">&nbsp;</div>
      </div>

    </div>
  );
}
