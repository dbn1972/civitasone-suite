import Link from "next/link";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { getMISSummary } from "../../../_data/loaders";

function changeColor(change: string | undefined): string {
  if (!change) return "text-slate-500";
  if (change.startsWith("+")) return "text-emerald-600";
  if (change.startsWith("-")) return "text-red-600";
  return "text-slate-500";
}

export default async function MISDashboardPage() {
  const { data: modules, source } = await getMISSummary();

  return (
    <main className="min-h-screen bg-slate-50 p-6 md:p-8">
      <section className="mx-auto max-w-7xl space-y-5">
        <nav aria-label="Breadcrumb" className="text-sm text-slate-600">
          <Link href="/reports" className="hover:text-slate-900">Reports</Link>
          <span className="mx-2">/</span>
          <span className="text-slate-900">MIS Dashboard</span>
        </nav>

        <header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-3xl font-semibold text-slate-900">Management Information System</h1>
            <p className="mt-1 text-sm text-slate-600">Consolidated metrics across all modules.</p>
          </div>
          {source === "error" ? <DataSourceBadge source={source} /> : null}
        </header>

        {modules.length === 0 ? (
          <div className="rounded-xl border border-slate-200 bg-white px-6 py-12 text-center shadow-sm">
            <p className="text-slate-400">MIS data is being compiled. Please check back shortly.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {modules.map((mod) => (
              <div key={mod.module} className="rounded-xl border border-slate-200 bg-white shadow-sm">
                <div className="border-b border-slate-100 px-5 py-3">
                  <h2 className="font-semibold text-slate-800">{mod.module}</h2>
                </div>
                <div className="overflow-x-auto">
                  <table className="min-w-full text-left text-sm">
                    <thead className="bg-slate-50 text-slate-600">
                      <tr>
                        <th className="px-4 py-2">Metric</th>
                        <th className="px-4 py-2 text-right">Value</th>
                        <th className="px-4 py-2">Unit</th>
                        <th className="px-4 py-2 text-right">Change</th>
                      </tr>
                    </thead>
                    <tbody>
                      {mod.metrics.map((m, i) => (
                        <tr key={i} className="border-t border-slate-100 hover:bg-slate-50">
                          <td className="px-4 py-2 text-slate-700">{m.label}</td>
                          <td className="px-4 py-2 text-right font-medium text-slate-900">{m.value}</td>
                          <td className="px-4 py-2 text-slate-500">{m.unit ?? "—"}</td>
                          <td className={`px-4 py-2 text-right text-xs font-medium ${changeColor(m.change)}`}>
                            {m.change ?? "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
