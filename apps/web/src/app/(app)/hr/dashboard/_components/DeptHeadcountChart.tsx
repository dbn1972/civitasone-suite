import Link from "next/link";

// GAP-HR-DASHBOARD-09: every entry now var()-wrapped -- #2563eb/#16a34a
// already match the established --info/--good tokens used fleet-wide (same
// fallback value, reused directly); #818cf8/#64748b/#a3a3a3 have no existing
// semantic match (plain rotating chart-series colours), so page-local
// --dash-dept-* names cover them instead. No token is defined anywhere for
// the new names, so every fallback renders identically to before this change.
const BAR_COLORS = ["var(--info, #2563eb)", "var(--warn, #d97706)", "var(--good, #16a34a)", "var(--dash-dept-series-4, #818cf8)", "var(--bad, #dc2626)", "var(--muted, #64748b)", "var(--dash-dept-series-7, #a3a3a3)"];

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
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--info, #2563eb)" strokeWidth="2.5" aria-hidden="true"><rect x="18" y="3" width="4" height="18"/><rect x="10" y="8" width="4" height="13"/><rect x="2" y="13" width="4" height="8"/></svg>
          Dept. Headcount
          {scopeNote && <span className="dept-scope-note">{scopeNote}</span>}
        </span>
        <Link href="/hr/employees" className="dept-link">Full view →</Link>
      </div>
      <div className="dept-body">
        {breakdown.length === 0 ? (
          <p style={{ padding: "24px 16px", textAlign: "center", color: "var(--muted,#64748b)", fontSize: 12 }}>No department data</p>
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
      <style>{`
        .dept-panel { background:var(--surface,#fff);border-radius:8px;box-shadow:0 1px 3px rgba(15,34,64,.09);overflow:hidden; }
        .dept-head { padding:13px 16px 11px;border-bottom:1px solid var(--border,#e2e8f0);display:flex;align-items:center;justify-content:space-between; }
        .dept-title { font-size:12px;font-weight:700;display:flex;align-items:center;gap:7px; }
        .dept-scope-note { font-size:9px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--muted,#64748b);background:var(--bg,#f1f5f9);border-radius:4px;padding:2px 6px; }
        .dept-link { font-size:11px;color:var(--info, #2563eb);font-weight:600;text-decoration:none; }
        .dept-body { padding:4px 0 8px; }
        .dept-row { padding:8px 16px; }
        .dept-meta { display:flex;justify-content:space-between;align-items:baseline;margin-bottom:4px; }
        .dept-name { font-size:12px;font-weight:500;color:var(--text,#0f172a);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:75%; }
        .dept-count { font-size:12px;font-weight:700;font-variant-numeric:tabular-nums; }
        .bar-track { height:5px;background:var(--slate-200,#e2e8f0);border-radius:3px;overflow:hidden; }
        .bar-fill { height:100%;border-radius:3px;transition:width .6s cubic-bezier(.4,0,.2,1); }
      `}</style>
    </div>
  );
}
