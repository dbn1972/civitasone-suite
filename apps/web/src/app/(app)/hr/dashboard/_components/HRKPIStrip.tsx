interface Props {
  headcount: number;
  headcountLastMonth: number;
  pendingLeaves: number;
  onLeave: number;
  departments: number;
  attendanceTodayPct: number;
  payrollDaysLeft: number;
}

export function HRKPIStrip({
  headcount, headcountLastMonth, pendingLeaves, onLeave,
  departments, attendanceTodayPct, payrollDaysLeft,
}: Props) {
  const hcDelta = headcount - headcountLastMonth;

  return (
    <div className="kpi-strip" role="list">
      {/* Headcount */}
      <div className="kpi-card kpi-blue" role="listitem">
        <div className="kpi-label">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#2563eb" strokeWidth="2" aria-hidden="true"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
          Headcount
        </div>
        <div className="kpi-val">{headcount.toLocaleString("en-IN")}</div>
        <div className={`kpi-trend ${hcDelta > 0 ? "trend-up" : hcDelta < 0 ? "trend-down" : "trend-flat"}`}>
          {hcDelta > 0 ? "↑" : hcDelta < 0 ? "↓" : "—"} {Math.abs(hcDelta)} this month
        </div>
      </div>

      {/* Pending Approvals */}
      <div className="kpi-card kpi-red" role="listitem" style={{ position: "relative" }}>
        {pendingLeaves > 0 && (
          <span className="kpi-badge" aria-label={`${pendingLeaves} pending`}>{pendingLeaves}</span>
        )}
        <div className="kpi-label">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#dc2626" strokeWidth="2" aria-hidden="true"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
          Pending Approvals
        </div>
        <div className="kpi-val">{pendingLeaves}</div>
        <div className={`kpi-trend ${pendingLeaves > 0 ? "trend-urgent" : "trend-flat"}`}>
          {pendingLeaves > 0 ? "⚡ Needs action" : "Inbox clear"}
        </div>
      </div>

      {/* On Leave */}
      <div className="kpi-card kpi-slate" role="listitem">
        <div className="kpi-label">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#64748b" strokeWidth="2" aria-hidden="true"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
          On Leave Today
        </div>
        <div className="kpi-val">{onLeave}</div>
        <div className="kpi-trend trend-flat">{onLeave === 0 ? "No leave today" : `${onLeave} absent`}</div>
      </div>

      {/* Payroll Closes */}
      <div className="kpi-card kpi-amber" role="listitem">
        <div className="kpi-label">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#d97706" strokeWidth="2" aria-hidden="true"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          Payroll Closes
        </div>
        <div className="kpi-val kpi-val-sm">{payrollDaysLeft} days</div>
        <div className="kpi-trend trend-flat">End of month</div>
      </div>

      {/* Departments */}
      <div className="kpi-card kpi-slate" role="listitem">
        <div className="kpi-label">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#64748b" strokeWidth="2" aria-hidden="true"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>
          Departments
        </div>
        <div className="kpi-val">{departments}</div>
        <div className="kpi-trend trend-flat">Across all grades</div>
      </div>

      {/* Present Today */}
      <div className="kpi-card kpi-slate" role="listitem">
        <div className="kpi-label">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#64748b" strokeWidth="2" aria-hidden="true"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
          Present Today
        </div>
        {attendanceTodayPct === 0 ? (
          <>
            <div className="kpi-val kpi-val-muted">—</div>
            <div className="kpi-trend trend-flat">Sync offline</div>
          </>
        ) : (
          <>
            <div className="kpi-val">{attendanceTodayPct}%</div>
            <div className="kpi-trend trend-up">Live attendance</div>
          </>
        )}
      </div>

      <style>{`
        .kpi-strip {
          display: grid;
          grid-template-columns: repeat(6, 1fr);
          gap: 10px;
          padding: 0 24px 14px;
        }
        @media (max-width: 900px) { .kpi-strip { grid-template-columns: repeat(3, 1fr); } }
        @media (max-width: 560px) { .kpi-strip { grid-template-columns: repeat(2, 1fr); } }
        .kpi-card {
          background: var(--surface, #fff);
          border-radius: 8px;
          padding: 14px 16px 12px;
          box-shadow: 0 1px 3px rgba(15,34,64,.09);
          border-top: 3px solid transparent;
        }
        .kpi-blue   { border-top-color: #2563eb; }
        .kpi-red    { border-top-color: #dc2626; }
        .kpi-amber  { border-top-color: #d97706; }
        .kpi-slate  { border-top-color: #cbd5e1; }
        .kpi-label {
          display: flex; align-items: center; gap: 4px;
          font-size: 10px; font-weight: 700; letter-spacing: .08em;
          text-transform: uppercase; color: var(--muted, #64748b); margin-bottom: 6px;
        }
        .kpi-val {
          font-size: 26px; font-weight: 700; letter-spacing: -.03em;
          font-variant-numeric: tabular-nums; line-height: 1;
          color: var(--text, #0f172a);
        }
        .kpi-val-sm  { font-size: 20px; }
        .kpi-val-muted { font-size: 20px; color: var(--muted, #64748b); }
        .kpi-trend { font-size: 11px; font-weight: 500; margin-top: 5px; }
        .trend-up     { color: #16a34a; }
        .trend-down   { color: #dc2626; }
        .trend-flat   { color: var(--muted, #64748b); }
        .trend-urgent { color: #dc2626; font-weight: 700; }
        .kpi-badge {
          position: absolute; top: 10px; right: 10px;
          background: #dc2626; color: #fff;
          font-size: 9px; font-weight: 800; border-radius: 9px;
          min-width: 18px; height: 18px;
          display: flex; align-items: center; justify-content: center; padding: 0 5px;
        }
      `}</style>
    </div>
  );
}
