import Link from "next/link";

// GAP-HR-DASHBOARD-09: rotating bar colours. Entries with a semantic match use
// the design-system tokens (--info/--warn/--good/--bad/--muted); series 4 and 7
// have none, so they are page-local --dash-dept-series-N tokens defined (light
// and dark) in dashboard.css.
const BAR_COLORS = ["var(--info)", "var(--warn)", "var(--good)", "var(--dash-dept-series-4)", "var(--bad)", "var(--muted)", "var(--dash-dept-series-7)"];

interface Props {
  breakdown: { name: string; count: number }[];
  /**
   * GAP-HR-DASHBOARD-08: safe non-decision fallback -- when set (a manager
   * viewer, per page.tsx's isManagerOnlyViewer), labels this chart as
   * organisation-wide for transparency. Does not change what data renders --
   * whether a manager's view of this chart should actually be scoped to
   * their reports is an open DPDP-relevant decision this fix does not make.
   */
  scopeNote?: string;
}

export function DeptHeadcountChart({ breakdown, scopeNote }: Props) {
  const max = Math.max(...breakdown.map((d) => d.count), 1);

  return (
    <div className="dept-panel">
      <div className="dept-head">
        <span className="dept-title">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--info)" strokeWidth="2.5" aria-hidden="true"><rect x="18" y="3" width="4" height="18"/><rect x="10" y="8" width="4" height="13"/><rect x="2" y="13" width="4" height="8"/></svg>
          Dept. Headcount
          {scopeNote && <span className="dept-scope-note">{scopeNote}</span>}
        </span>
        <Link href="/hr/employees" className="dept-link">Full view →</Link>
      </div>
      <div className="dept-body">
        {breakdown.length === 0 ? (
          <p style={{ padding: "24px 16px", textAlign: "center", color: "var(--muted)", fontSize: 12 }}>No department data</p>
        ) : (
          breakdown.map((dept, i) => (
            <div key={dept.name} className="dept-row">
              <div className="dept-meta">
                <span className="dept-name" title={dept.name}>{dept.name}</span>
                <span className="dept-count">{dept.count}</span>
              </div>
              <div className="bar-track">
                <div className="bar-fill" style={{ width: `${(dept.count / max) * 100}%`, background: BAR_COLORS[i % BAR_COLORS.length] }} />
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
