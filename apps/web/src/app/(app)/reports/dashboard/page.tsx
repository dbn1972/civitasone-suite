import Link from "next/link";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { getReportsDashboard } from "../../../_data/loaders";

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
    <svg
      width="100%"
      viewBox={`0 0 ${BAR_W} ${BAR_H}`}
      aria-label="Module KPI value bar chart"
      role="img"
    >
      {items.map((kpi, i) => {
        const ratio = (kpi.value ?? 0) / maxVal;
        const barH = Math.max(4, Math.round(ratio * (chartH - 8)));
        const x = BAR_PAD + i * (barW + BAR_GAP);
        const y = chartH - barH;
        const opacity = 0.45 + (i / Math.max(totalBars - 1, 1)) * 0.5;
        const label = (kpi.module || kpi.title).slice(0, 10);
        return (
          <g key={kpi.id}>
            <rect
              x={x}
              y={y}
              width={barW}
              height={barH}
              rx={4}
              fill="#0369a1"
              opacity={opacity}
            />
            <text
              x={x + barW / 2}
              y={BAR_H - 2}
              textAnchor="middle"
              fontSize={9}
              fill="#98a2b3"
            >
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
    <svg
      width={132}
      height={132}
      viewBox="0 0 132 132"
      aria-label={`Outcome index: ${achievedPct.toFixed(0)}%`}
      role="img"
    >
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="#eef0f4" strokeWidth={13} />
      <circle
        cx={cx}
        cy={cy}
        r={r}
        fill="none"
        stroke="#0369a1"
        strokeWidth={13}
        strokeDasharray={circ}
        strokeDashoffset={offset}
        strokeLinecap="round"
        transform={`rotate(-90 ${cx} ${cy})`}
      />
      <text x="50%" y="46%" textAnchor="middle" dy=".1em" fontSize={22} fontWeight={780} fill="#101828">
        {achievedPct.toFixed(0)}%
      </text>
      <text x="50%" y="63%" textAnchor="middle" fontSize={9.5} fill="#98a2b3">
        composite
      </text>
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

  return (
    <main className="min-h-screen bg-slate-50 p-6 md:p-8">
      <section className="mx-auto max-w-7xl space-y-5">
        <nav aria-label="Breadcrumb" className="text-sm text-slate-600">
          <Link href="/reports" className="hover:text-slate-900">Reports</Link>
          <span className="mx-2">/</span>
          <span className="text-slate-900">Dashboard</span>
        </nav>

        <header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-3xl font-semibold text-slate-900">Data &amp; Analytics</h1>
            <p className="mt-1 text-sm text-slate-600">
              {data.summary ?? "Executive dashboards, KPIs and cross-module analytics."}
            </p>
          </div>
          {source === "error" ? <DataSourceBadge source={source} /> : null}
        </header>

        <section aria-label="KPI summary statistics" className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">KPIs Tracked</p>
            <p className="mt-1 text-2xl font-bold text-slate-900">{data.kpis.length.toLocaleString("en-IN")}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Trending Up</p>
            <p className="mt-1 text-2xl font-bold text-emerald-600">{upKpis.toLocaleString("en-IN")}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Trending Down</p>
            <p className="mt-1 text-2xl font-bold text-red-600">{downKpis.toLocaleString("en-IN")}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Modules Tracked</p>
            <p className="mt-1 text-2xl font-bold text-blue-600">{modules.toLocaleString("en-IN")}</p>
          </div>
        </section>

        {data.kpis.length === 0 ? (
          <div className="rounded-xl border border-slate-200 bg-white px-6 py-12 text-center shadow-sm">
            <p className="text-slate-400">No KPI data available. The analytics service is compiling data.</p>
          </div>
        ) : (
          <div className="grid gap-5 lg:grid-cols-3">
            <div className="space-y-5 lg:col-span-2">
              <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="mb-3 flex items-center justify-between">
                  <h2 className="text-base font-semibold text-slate-800">KPI values by module</h2>
                  <span className="text-xs text-slate-400">top 8</span>
                </div>
                <ModuleBarChart kpis={data.kpis} />
              </section>

              <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
                <div className="border-b border-slate-100 px-5 py-3">
                  <h2 className="text-base font-semibold text-slate-800">KPI Overview</h2>
                </div>
                <div className="overflow-x-auto">
                  <table aria-label="KPI overview table" className="min-w-full text-left text-sm">
                    <thead className="bg-slate-50 text-slate-600">
                      <tr>
                        <th scope="col" className="px-4 py-3">KPI</th>
                        <th scope="col" className="px-4 py-3">Module</th>
                        <th scope="col" className="px-4 py-3 text-right">Value</th>
                        <th scope="col" className="px-4 py-3">Unit</th>
                        <th scope="col" className="px-4 py-3">Trend</th>
                        <th scope="col" className="px-4 py-3 text-right">Change</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.kpis.map((kpi) => (
                        <tr key={kpi.id} className="border-t border-slate-100 hover:bg-slate-50">
                          <td className="px-4 py-3 font-medium text-slate-900">{kpi.title}</td>
                          <td className="px-4 py-3 text-slate-500 text-xs uppercase tracking-wide">{kpi.module}</td>
                          <td className="px-4 py-3 text-right text-slate-800">
                            {kpi.value !== undefined ? kpi.value.toLocaleString("en-IN") : "—"}
                          </td>
                          <td className="px-4 py-3 text-slate-500">{kpi.unit ?? "—"}</td>
                          <td className="px-4 py-3 text-center">
                            {kpi.changeDirection === "up" ? (
                              <span className="text-emerald-600">↑</span>
                            ) : kpi.changeDirection === "down" ? (
                              <span className="text-red-600">↓</span>
                            ) : (
                              <span className="text-slate-400">→</span>
                            )}
                          </td>
                          <td className={`px-4 py-3 text-right text-xs font-medium ${
                            kpi.changePct === undefined ? "text-slate-400" :
                            kpi.changePct >= 0 ? "text-emerald-600" : "text-red-600"
                          }`}>
                            {kpi.changePct !== undefined
                              ? `${kpi.changePct >= 0 ? "+" : ""}${kpi.changePct.toFixed(1)}%`
                              : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            </div>

            <div className="space-y-5">
              <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
                <h2 className="mb-3 text-base font-semibold text-slate-800">Outcome index</h2>
                <div className="flex justify-center">
                  <OutcomeDonut achievedPct={outcomePct} />
                </div>
              </section>

              <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
                <h2 className="mb-3 text-base font-semibold text-slate-800">Trend summary</h2>
                <div className="space-y-3">
                  {[
                    { label: "Trending up", count: upKpis, color: "bg-emerald-500" },
                    { label: "Trending down", count: downKpis, color: "bg-red-500" },
                    { label: "Stable / neutral", count: neutralKpis, color: "bg-slate-300" },
                  ].map(({ label, count, color }) => {
                    const total = data.kpis.length || 1;
                    const pct = Math.round((count / total) * 100);
                    return (
                      <div key={label} className="flex items-center gap-3">
                        <span className="w-32 shrink-0 text-right text-xs text-slate-500">{label}</span>
                        <div className="flex-1 rounded bg-slate-100 h-3">
                          <div className={`h-3 rounded ${color}`} style={{ width: `${pct}%` }} />
                        </div>
                        <span className="w-10 text-right text-xs font-medium text-slate-700">{count}</span>
                      </div>
                    );
                  })}
                </div>
              </section>

              <section className="grid grid-cols-1 gap-2">
                {[
                  { label: "Report Jobs", href: "/reports/list" },
                  { label: "KPI Tracker", href: "/reports/kpi" },
                  { label: "MIS Dashboard", href: "/reports/mis" },
                ].map((link) => (
                  <Link
                    key={link.href}
                    href={link.href}
                    className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md text-sm font-medium text-slate-800"
                  >
                    {link.label} →
                  </Link>
                ))}
              </section>
            </div>
          </div>
        )}
      </section>
    </main>
  );
}
