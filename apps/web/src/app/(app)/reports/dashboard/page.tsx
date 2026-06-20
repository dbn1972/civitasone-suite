import Link from "next/link";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { getReportsDashboard } from "../../../_data/loaders";

export default async function ReportsDashboardPage() {
  const { data, source } = await getReportsDashboard();

  const upKpis = data.kpis.filter((k) => k.changeDirection === "up").length;
  const downKpis = data.kpis.filter((k) => k.changeDirection === "down").length;

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
            <h1 className="text-3xl font-semibold text-slate-900">Reports & Analytics Dashboard</h1>
            <p className="mt-1 text-sm text-slate-600">
              {data.summary ?? "KPI overview and module activity across the platform."}
            </p>
          </div>
          {source === "error" ? <DataSourceBadge source={source} /> : null}
        </header>

        <section className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Total KPIs</p>
            <p className="mt-1 text-2xl font-bold text-slate-900">{data.kpis.length}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Trending Up</p>
            <p className="mt-1 text-2xl font-bold text-green-600">{upKpis}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Trending Down</p>
            <p className="mt-1 text-2xl font-bold text-red-600">{downKpis}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Modules Tracked</p>
            <p className="mt-1 text-2xl font-bold text-blue-600">
              {new Set(data.kpis.map((k) => k.module)).size}
            </p>
          </div>
        </section>

        {data.kpis.length > 0 && (
          <>
            <section>
              <h2 className="mb-3 text-lg font-semibold text-slate-800">KPI Overview</h2>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {data.kpis.map((kpi) => (
                  <div key={kpi.id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-xs text-slate-400 uppercase tracking-wide">{kpi.module}</p>
                        <p className="mt-0.5 text-sm font-medium text-slate-700">{kpi.title}</p>
                      </div>
                      {kpi.changeDirection && (
                        <span className={`text-base ${kpi.changeDirection === "up" ? "text-green-500" : kpi.changeDirection === "down" ? "text-red-500" : "text-slate-400"}`}>
                          {kpi.changeDirection === "up" ? "↑" : kpi.changeDirection === "down" ? "↓" : "→"}
                        </span>
                      )}
                    </div>
                    <div className="mt-2 flex items-end gap-1">
                      <span className="text-2xl font-bold text-slate-900">
                        {kpi.value !== undefined ? kpi.value.toLocaleString("en-IN") : "—"}
                      </span>
                      {kpi.unit && <span className="mb-0.5 text-xs text-slate-500">{kpi.unit}</span>}
                    </div>
                    {kpi.changePct !== undefined && (
                      <p className={`mt-1 text-xs font-medium ${kpi.changePct >= 0 ? "text-green-600" : "text-red-600"}`}>
                        {kpi.changePct >= 0 ? "+" : ""}{kpi.changePct.toFixed(1)}% vs prev period
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </section>

            <section>
              <h2 className="mb-3 text-lg font-semibold text-slate-800">Module Activity</h2>
              <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
                {(() => {
                  const maxVal = Math.max(...data.kpis.filter((k) => k.value !== undefined).map((k) => k.value ?? 0), 1);
                  return (
                    <div className="space-y-3">
                      {data.kpis.filter((k) => k.value !== undefined).map((kpi) => {
                        const pct = Math.min(((kpi.value ?? 0) / maxVal) * 100, 100);
                        return (
                          <div key={kpi.id} className="flex items-center gap-3">
                            <span className="w-36 shrink-0 text-right text-xs text-slate-500 truncate" title={kpi.title}>
                              {kpi.title}
                            </span>
                            <div className="flex-1 rounded bg-slate-100 h-4">
                              <div
                                className="h-4 rounded bg-blue-500 transition-all"
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                            <span className="w-20 text-right text-xs font-medium text-slate-700">
                              {(kpi.value ?? 0).toLocaleString("en-IN")} {kpi.unit ?? ""}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  );
                })()}
              </div>
            </section>
          </>
        )}

        {data.kpis.length === 0 && (
          <div className="rounded-xl border border-slate-200 bg-white px-6 py-12 text-center shadow-sm">
            <p className="text-slate-400">No KPI data available. Check back after the analytics service has processed data.</p>
          </div>
        )}

        <section className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
          {[
            { label: "Reports List", href: "/reports/list" },
            { label: "KPI Tracker", href: "/reports/kpi" },
            { label: "MIS Dashboard", href: "/reports/mis" },
          ].map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md text-sm font-medium text-slate-800"
            >
              {link.label}
            </Link>
          ))}
        </section>
      </section>
    </main>
  );
}
