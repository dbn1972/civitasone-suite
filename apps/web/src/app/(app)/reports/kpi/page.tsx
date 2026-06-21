import Link from "next/link";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { getKPIs } from "../../../_data/loaders";

const statusColors: Record<string, string> = {
  on_track: "bg-emerald-50 text-emerald-700",
  at_risk: "bg-amber-50 text-amber-700",
  off_track: "bg-red-50 text-red-700",
};

const statusLabels: Record<string, string> = {
  on_track: "On track",
  at_risk: "At risk",
  off_track: "Off track",
};

function achievementColor(pct: number): string {
  if (pct >= 100) return "text-emerald-600 font-bold";
  if (pct >= 75) return "text-amber-600 font-semibold";
  return "text-red-600 font-semibold";
}

function achievementBarColor(pct: number): string {
  if (pct >= 100) return "bg-emerald-500";
  if (pct >= 75) return "bg-amber-500";
  return "bg-red-500";
}

export default async function KPITrackerPage() {
  const { data: kpis, source } = await getKPIs();

  const onTrack = kpis.filter((k) => k.status === "on_track").length;
  const atRisk = kpis.filter((k) => k.status === "at_risk").length;
  const offTrack = kpis.filter((k) => k.status === "off_track").length;

  return (
    <main className="min-h-screen bg-slate-50 p-6 md:p-8">
      <section className="mx-auto max-w-7xl space-y-5">
        <nav aria-label="Breadcrumb" className="text-sm text-slate-600">
          <Link href="/reports" className="hover:text-slate-900">Reports</Link>
          <span className="mx-2">/</span>
          <span className="text-slate-900">KPI Tracker</span>
        </nav>

        <header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-3xl font-semibold text-slate-900">KPI Monitoring</h1>
            <p className="mt-1 text-sm text-slate-600">Department KPIs &amp; outcome indicators with targets.</p>
          </div>
          {source === "error" ? <DataSourceBadge source={source} /> : null}
        </header>

        <section aria-label="KPI statistics" className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">KPIs Tracked</p>
            <p className="mt-1 text-2xl font-bold text-slate-900">{kpis.length.toLocaleString("en-IN")}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">On / Above Target</p>
            <p className="mt-1 text-2xl font-bold text-emerald-600">{onTrack.toLocaleString("en-IN")}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">At Risk</p>
            <p className="mt-1 text-2xl font-bold text-amber-600">{atRisk.toLocaleString("en-IN")}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Off Track</p>
            <p className="mt-1 text-2xl font-bold text-red-600">{offTrack.toLocaleString("en-IN")}</p>
          </div>
        </section>

        {kpis.length > 0 && (
          <section
            aria-label="Achievement vs target bar chart"
            className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
          >
            <h2 className="mb-4 text-sm font-semibold text-slate-700">Achievement vs Target</h2>
            <div className="space-y-3" role="list" aria-label="KPI achievement bars">
              {kpis.map((kpi) => (
                <div key={kpi.id} className="flex items-center gap-3" role="listitem">
                  <span
                    className="w-44 shrink-0 text-right text-xs text-slate-500 truncate"
                    title={kpi.kpiName}
                  >
                    {kpi.kpiName}
                  </span>
                  <div
                    className="flex-1 rounded bg-slate-100 h-4"
                    role="progressbar"
                    aria-valuenow={Math.min(kpi.achievementPct, 100)}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label={`${kpi.kpiName}: ${kpi.achievementPct.toFixed(1)}%`}
                  >
                    <div
                      className={`h-4 rounded transition-all ${achievementBarColor(kpi.achievementPct)}`}
                      style={{ width: `${Math.min(kpi.achievementPct, 100)}%` }}
                    />
                  </div>
                  <span className={`w-16 text-right text-xs ${achievementColor(kpi.achievementPct)}`}>
                    {kpi.achievementPct.toFixed(1)}%
                  </span>
                </div>
              ))}
            </div>
          </section>
        )}

        <section className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table aria-label="KPI monitoring table" className="min-w-full text-left text-sm">
            <thead className="bg-slate-100 text-slate-700">
              <tr>
                <th scope="col" className="px-4 py-3">KPI</th>
                <th scope="col" className="px-4 py-3">Owner Module</th>
                <th scope="col" className="px-4 py-3 text-right">Target</th>
                <th scope="col" className="px-4 py-3 text-right">Actual</th>
                <th scope="col" className="px-4 py-3">Unit</th>
                <th scope="col" className="px-4 py-3 text-right">Achievement %</th>
                <th scope="col" className="px-4 py-3">Period</th>
                <th scope="col" className="px-4 py-3">Trend</th>
                <th scope="col" className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {kpis.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-10 text-center text-slate-400">
                    No KPI data available. KPIs will appear once the service has processed data.
                  </td>
                </tr>
              ) : (
                kpis.map((kpi) => (
                  <tr key={kpi.id} className="border-t border-slate-200 hover:bg-slate-50">
                    <td className="px-4 py-3 font-medium text-slate-900">{kpi.kpiName}</td>
                    <td className="px-4 py-3 text-slate-600">{kpi.module}</td>
                    <td className="px-4 py-3 text-right text-slate-700">
                      {kpi.targetValue.toLocaleString("en-IN")}
                    </td>
                    <td className="px-4 py-3 text-right text-slate-700">
                      {kpi.currentValue.toLocaleString("en-IN")}
                    </td>
                    <td className="px-4 py-3 text-slate-600">{kpi.unit}</td>
                    <td className={`px-4 py-3 text-right ${achievementColor(kpi.achievementPct)}`}>
                      {kpi.achievementPct.toFixed(1)}%
                    </td>
                    <td className="px-4 py-3 text-slate-600">{kpi.period}</td>
                    <td className="px-4 py-3 text-center">
                      {kpi.trend === "up" ? (
                        <span className="text-emerald-600 font-medium" aria-label="Trending up">↑</span>
                      ) : kpi.trend === "down" ? (
                        <span className="text-red-600 font-medium" aria-label="Trending down">↓</span>
                      ) : (
                        <span className="text-slate-400" aria-label="Stable">→</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2 py-1 text-xs font-medium ${statusColors[kpi.status] ?? "bg-slate-100 text-slate-600"}`}>
                        {statusLabels[kpi.status] ?? kpi.status}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </section>
      </section>
    </main>
  );
}
