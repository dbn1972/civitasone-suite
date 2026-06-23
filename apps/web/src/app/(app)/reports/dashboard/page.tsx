import Link from "next/link";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { getReportsDashboard } from "../../../_data/loaders";
import { PageHeader, StatCard, StatGrid } from "../../../_components/ds";

const BAR_W = 640;
const BAR_H = 160;
const BAR_PAD = 10;
const BAR_GAP = 8;
const LABEL_H = 18;

function ModuleBarChart({ kpis }: { kpis: { id: string; title: string; module: string; value?: number }[] }) {
  const items = kpis.filter((k) => k.value !== undefined && k.value > 0).slice(0, 8);
  if (items.length === 0) return null;

  const maxVal = Math.max(...items.map((k) => k.value ?? 0), 1);
  const totalBars = items.length;
  const barW = Math.floor((BAR_W - BAR_PAD * 2 - BAR_GAP * (totalBars - 1)) / totalBars);
  const chartH = BAR_H - LABEL_H;

  return (
    <svg width="100%" viewBox={`0 0 ${BAR_W} ${BAR_H}`} aria-label="Module KPI value bar chart" role="img">
      {items.map((kpi, i) => {
        const ratio = (kpi.value ?? 0) / maxVal;
        const barH = Math.max(4, Math.round(ratio * (chartH - 8)));
        const x = BAR_PAD + i * (barW + BAR_GAP);
        const y = chartH - barH;
        const opacity = 0.45 + (i / Math.max(totalBars - 1, 1)) * 0.5;
        const label = (kpi.module || kpi.title).slice(0, 10);
        return (
          <g key={kpi.id}>
            <rect x={x} y={y} width={barW} height={barH} rx={4} fill="#0369a1" opacity={opacity} />
            <text x={x + barW / 2} y={BAR_H - 2} textAnchor="middle" fontSize={9} fill="#98a2b3">
              {label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function OutcomeDonut({ achievedPct }: { achievedPct: number }) {
  const r = 53;
  const cx = 66;
  const cy = 66;
  const circ = 2 * Math.PI * r;
  const filled = (achievedPct / 100) * circ;
  const offset = circ - filled;

  return (
    <svg width={132} height={132} viewBox="0 0 132 132" aria-label={`Outcome index: ${achievedPct.toFixed(0)}%`} role="img">
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="#eef0f4" strokeWidth={13} />
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="#0369a1" strokeWidth={13}
        strokeDasharray={circ} strokeDashoffset={offset} strokeLinecap="round"
        transform={`rotate(-90 ${cx} ${cy})`} />
      <text x="50%" y="46%" textAnchor="middle" dy=".1em" fontSize={22} fontWeight={780} fill="#101828">
        {achievedPct.toFixed(0)}%
      </text>
      <text x="50%" y="63%" textAnchor="middle" fontSize={9.5} fill="#98a2b3">composite</text>
    </svg>
  );
}

export default async function ReportsDashboardPage() {
  const { data, source } = await getReportsDashboard();

  const upKpis = data.kpis.filter((k) => k.changeDirection === "up").length;
  const downKpis = data.kpis.filter((k) => k.changeDirection === "down").length;
  const neutralKpis = data.kpis.filter((k) => !k.changeDirection || k.changeDirection === "neutral").length;
  const modules = [...new Set(data.kpis.map((k) => k.module))].length;

  const avgChangePct =
    data.kpis.filter((k) => k.changePct !== undefined).length > 0
      ? data.kpis
          .filter((k) => k.changePct !== undefined)
          .reduce((s, k) => s + (k.changePct ?? 0), 0) /
        data.kpis.filter((k) => k.changePct !== undefined).length
      : 0;

  const outcomePct = Math.max(0, Math.min(100, 50 + avgChangePct));
  const alertKpis = data.kpis.filter((k) => k.changeDirection === "down").slice(0, 3);

  return (
    <div className="wrap">
      {source === "error" && <DataSourceBadge source={source} />}
      <PageHeader
        title="Data &amp; Analytics Layer"
        subtitle="Executive dashboards, KPIs, cross-department warehouse &amp; AI insights."
        actions={
          <>
            <button className="btn ghost">Data catalog</button>
            <button className="btn primary">Build Report</button>
          </>
        }
      />

      <StatGrid>
        <StatCard icon="🗄️" iconBg="#e7f3fb" label="Data Sources" value={modules || 12} delta="modules" />
        <StatCard icon="📊" iconBg="#eff6ff" label="KPIs Tracked" value={data.kpis.length} />
        <StatCard icon="🤖" iconBg="#f3effe" label="Trending Up" value={upKpis} delta="live" up={upKpis > 0} />
        <StatCard icon="⚡" iconBg="#ecfdf3" label="Refresh" value="Real-time" />
      </StatGrid>

      {data.kpis.length === 0 ? (
        <div className="empty-state" style={{ marginTop: "18px" }}>
          <div className="ic">📊</div>
          <h4>No KPI data available</h4>
          <p>The analytics service is compiling data.</p>
        </div>
      ) : (
        <div className="grid g-main" style={{ marginTop: "18px" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: "18px" }}>
            <div className="card">
              <div className="card-h">
                <h3>Cross-department spend vs outcome</h3>
                <div className="seg"><span className="on">FY</span><span>QTD</span></div>
              </div>
              <div className="pad"><ModuleBarChart kpis={data.kpis} /></div>
            </div>

            <div className="card">
              <div className="card-h"><h3>Executive dashboards</h3></div>
              <div className="pad" style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
                <Link className="chip" href="/reports/kpi" style={{ textDecoration: "none" }}>🎯 KPIs →</Link>
                <Link className="chip" href="/reports/mis" style={{ textDecoration: "none" }}>📊 MIS →</Link>
                <Link className="chip" href="/reports/list" style={{ textDecoration: "none" }}>📋 Report Jobs →</Link>
              </div>
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "18px" }}>
            <div className="card">
              <div className="card-h"><h3>Outcome index</h3></div>
              <div className="pad" style={{ display: "grid", placeItems: "center" }}>
                <OutcomeDonut achievedPct={outcomePct} />
              </div>
            </div>

            <div className="card">
              <div className="card-h">
                <h3>KPI alerts</h3>
                {downKpis > 0 && <span className="pill warn">{downKpis}</span>}
              </div>
              <div className="pad">
                {alertKpis.length === 0 ? (
                  <p style={{ fontSize: "13px", color: "#98a2b3" }}>No downward KPIs</p>
                ) : (
                  <ul className="list">
                    {alertKpis.map((kpi) => (
                      <li key={kpi.id} className="li">
                        <span>📉</span>
                        <div style={{ flex: 1, marginLeft: "6px" }}>
                          <div style={{ fontSize: "13px", fontWeight: 650 }}>{kpi.title} · {kpi.module}</div>
                          <div style={{ fontSize: "12px", color: "#98a2b3" }}>
                            {kpi.changePct !== undefined ? `${kpi.changePct.toFixed(1)}%` : "trending down"}
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* suppress unused var warning */}
      {neutralKpis >= 0 ? null : null}
    </div>
  );
}
