import Link from "next/link";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { getReportsDashboard } from "../../../_data/loaders";
import { EmptyState, PageHeader, RefreshErrorState, StatCard, StatGrid } from "../../../_components/ds";
import { toHumanError } from "@/lib/messages";

const BAR_W = 640;
const BAR_H = 180;
const BAR_PAD = 10;
const BAR_GAP = 8;
const LABEL_H = 18;
const VALUE_H = 14;

type DashKpi = { id: string; title: string; module: string; value?: number };

function ModuleBarChart({ kpis }: { kpis: DashKpi[] }) {
  const items = kpis.filter((k) => k.value !== undefined && k.value > 0).slice(0, 8);
  if (items.length === 0) return null; // ux-001-ok: pure chart renderer over already-resolved KPI values; the parent page owns loading/error state

  const maxVal = Math.max(...items.map((k) => k.value ?? 0), 1);
  const totalBars = items.length;
  const barW = Math.floor((BAR_W - BAR_PAD * 2 - BAR_GAP * (totalBars - 1)) / totalBars);
  const chartH = BAR_H - LABEL_H - VALUE_H;

  return (
    <figure style={{ margin: 0 }}>
      <svg width="100%" viewBox={`0 0 ${BAR_W} ${BAR_H}`} role="img" aria-label="KPI current value by module">
        {items.map((kpi, i) => {
          const ratio = (kpi.value ?? 0) / maxVal;
          const barH = Math.max(4, Math.round(ratio * (chartH - 8)));
          const x = BAR_PAD + i * (barW + BAR_GAP);
          const y = VALUE_H + (chartH - barH);
          // GAP-REPORTS-DASHBOARD-05: a constant fill — the previous
          // position-stepped opacity implied a ranking the unsorted bars do not
          // have.
          // GAP-REPORTS-DASHBOARD-04: theme tokens, not hard-coded hex, so bars
          // and labels stay visible in dark mode; full module name (not sliced
          // to 10 chars) and a value label above each bar at >= 11px.
          const label = kpi.module || kpi.title;
          return (
            <g key={kpi.id}>
              <rect x={x} y={y} width={barW} height={barH} rx={4} fill="var(--primary)" />
              <text x={x + barW / 2} y={y - 4} textAnchor="middle" fontSize={11} fill="var(--ink)">
                {(kpi.value ?? 0).toLocaleString("en-IN")}
              </text>
              <text x={x + barW / 2} y={BAR_H - 4} textAnchor="middle" fontSize={11} fill="var(--mut)">
                {label}
              </text>
            </g>
          );
        })}
      </svg>
      <figcaption style={{ fontSize: "12px", color: "var(--mut)", marginTop: 6 }}>
        Current KPI value by owning module (top {items.length} by value).
      </figcaption>
      {/* GAP-REPORTS-DASHBOARD-04: a visually-hidden table so the same data is
          available to screen readers, not only as an SVG. */}
      <table className="sr-only">
        <caption>Current KPI value by module</caption>
        <thead>
          <tr><th scope="col">Module</th><th scope="col">Value</th></tr>
        </thead>
        <tbody>
          {items.map((kpi) => (
            <tr key={kpi.id}>
              <td>{kpi.module || kpi.title}</td>
              <td>{(kpi.value ?? 0).toLocaleString("en-IN")}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

export default async function ReportsDashboardPage() {
  const { data, source } = await getReportsDashboard();
  const errored = source === "error";

  const upKpis = data.kpis.filter((k) => k.changeDirection === "up").length;
  const downKpis = data.kpis.filter((k) => k.changeDirection === "down").length;
  const modules = [...new Set(data.kpis.map((k) => k.module))].length;

  // GAP-REPORTS-DASHBOARD-02: the old "Outcome index" was 50 + avg(changePct),
  // a fabricated 0–100 score with no outcome definition that read 50% on flat
  // data. Replace it with a real, traceable ratio: the share of KPIs that are
  // trending up. Only shown when at least one KPI carries a direction.
  const directedKpis = data.kpis.filter((k) => k.changeDirection === "up" || k.changeDirection === "down").length;
  const trendingUpPct = directedKpis > 0 ? Math.round((upKpis / directedKpis) * 100) : null;

  const alertKpis = data.kpis.filter((k) => k.changeDirection === "down").slice(0, 3);

  return (
    <div className="wrap">
      {source === "error" && <DataSourceBadge source={source} />}
      <PageHeader
        title="Data &amp; Analytics Layer"
        subtitle="Executive dashboards, KPIs, cross-department warehouse &amp; AI insights."
        actions={
          <Link href="/reports/list/new" className="btn primary">Build Report</Link>
        }
      />

      {/* GAP-REPORTS-DASHBOARD-01: no fabricated figures. On error every stat
          reads "—" (StatCard renders null as an em dash), never the old
          `modules || 12` or the constant "Real-time"/`delta="live"`. */}
      <StatGrid>
        <StatCard icon="🗄️" tone="info" label="Data Sources" value={errored ? null : modules} delta="modules" />
        <StatCard icon="📊" tone="info" label="KPIs Tracked" value={errored ? null : data.kpis.length} />
        <StatCard icon="📈" tone="good" label="Trending Up" value={errored ? null : upKpis} up={upKpis > 0} />
        <StatCard
          icon="⚡"
          tone="neutral"
          label="Trending Up Share"
          value={errored || trendingUpPct === null ? null : `${trendingUpPct}%`}
        />
      </StatGrid>

      {errored ? (
        <RefreshErrorState error={toHumanError("load", { area: "analytics dashboard" })} />
      ) : data.kpis.length === 0 ? (
        <EmptyState icon="📊" title="No KPI data available" message="The analytics service is compiling data." />
      ) : (
        <div className="grid g-main" style={{ marginTop: "18px" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: "18px" }}>
            <div className="card">
              <div className="card-h">
                {/* GAP-REPORTS-DASHBOARD-03: the chart plots KPI values, not
                    spend-vs-outcome; title now matches the data. The non-wired
                    FY/QTD SpendSegmented control (local state only, changed
                    nothing) has been removed. */}
                <h3>KPI values by module</h3>
              </div>
              <div className="pad"><ModuleBarChart kpis={data.kpis} /></div>
            </div>

            <div className="card">
              <div className="card-h"><h3>Executive dashboards</h3></div>
              <div className="pad" style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
                <Link className="chip" href="/reports/kpi" style={{ textDecoration: "none" }}><span aria-hidden>🎯</span> KPIs <span aria-hidden>→</span></Link>
                <Link className="chip" href="/reports/mis" style={{ textDecoration: "none" }}><span aria-hidden>📊</span> MIS <span aria-hidden>→</span></Link>
                <Link className="chip" href="/reports/list" style={{ textDecoration: "none" }}><span aria-hidden>📋</span> Report Jobs <span aria-hidden>→</span></Link>
              </div>
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "18px" }}>
            {trendingUpPct !== null && (
              <div className="card">
                <div className="card-h"><h3>KPIs trending up</h3></div>
                <div className="pad" style={{ display: "grid", placeItems: "center", gap: 6 }}>
                  <div style={{ fontSize: 34, fontWeight: 780, color: "var(--ink)" }}>{trendingUpPct}%</div>
                  <div style={{ fontSize: 12, color: "var(--mut)" }}>
                    {upKpis} of {directedKpis} KPIs with a trend are improving
                  </div>
                </div>
              </div>
            )}

            <div className="card">
              <div className="card-h">
                <h3>KPI alerts</h3>
                {downKpis > 0 && <span className="pill warn">{downKpis}</span>}
              </div>
              <div className="pad">
                {alertKpis.length === 0 ? (
                  <p style={{ fontSize: "13px", color: "var(--mut)" }}>No downward KPIs</p>
                ) : (
                  <ul className="list">
                    {alertKpis.map((kpi) => (
                      <li key={kpi.id} className="li">
                        <span aria-hidden>📉</span>
                        <div style={{ flex: 1, marginLeft: "6px" }}>
                          <div style={{ fontSize: "13px", fontWeight: 650 }}>{kpi.title} · {kpi.module}</div>
                          <div style={{ fontSize: "12px", color: "var(--mut)" }}>
                            {/* GAP-REPORTS-DASHBOARD-05: the dashboard payload
                                carries no period field, so the change is
                                qualified as "vs previous period" rather than a
                                bare percentage with no reference window. */}
                            {kpi.changePct !== undefined
                              ? `${kpi.changePct.toFixed(1)}% vs previous period`
                              : "Trending down vs previous period"}
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
    </div>
  );
}
