import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { PageShell } from "../../../_components/PageShell";
import { getTicketAnalytics } from "../../../_data/loaders";

export default async function Page() {
  const { data: analytics, source } = await getTicketAnalytics();

  const stats = [
    { label: "Total Tickets", value: analytics.totalTickets.toLocaleString("en-IN") },
    { label: "Open", value: analytics.openTickets.toLocaleString("en-IN") },
    { label: "Resolved This Month", value: analytics.resolvedThisMonth.toLocaleString("en-IN") },
    { label: "SLA Breached", value: analytics.slaBreachedCount.toLocaleString("en-IN") },
    { label: "Avg Resolution (hrs)", value: analytics.avgResolutionHours.toFixed(1) },
  ];

  return (
    <PageShell title="Helpdesk Reports" description="Service performance and support quality indicators.">
      {source === "error" ? <DataSourceBadge source={source} /> : null}

      <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
        {stats.map((s) => (
          <div key={s.label} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-xs text-slate-500">{s.label}</p>
            <p className="mt-1 text-2xl font-semibold text-slate-900">{s.value}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-5 md:grid-cols-2">
        <section className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 px-4 py-3 text-sm font-semibold text-slate-800">
            By Priority
          </div>
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="px-4 py-2 text-left">Priority</th>
                <th className="px-4 py-2 text-right">Count</th>
                <th className="px-4 py-2 text-left w-32">% of Total</th>
              </tr>
            </thead>
            <tbody>
              {analytics.byPriority.length === 0 ? (
                <tr>
                  <td colSpan={3} className="px-4 py-4 text-center text-slate-400">No data</td>
                </tr>
              ) : (
                analytics.byPriority.map((row) => (
                  <tr key={row.priority} className="border-t border-slate-100">
                    <td className="px-4 py-2 capitalize text-slate-800">{row.priority}</td>
                    <td className="px-4 py-2 text-right text-slate-700">{row.count.toLocaleString("en-IN")}</td>
                    <td className="px-4 py-2">
                      <div className="flex items-center gap-2">
                        <div className="h-2 rounded-full bg-indigo-200" style={{ width: `${Math.min(row.pct, 100)}%`, minWidth: "4px" }} />
                        <span className="text-xs text-slate-500">{row.pct.toFixed(1)}%</span>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </section>

        <section className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 px-4 py-3 text-sm font-semibold text-slate-800">
            By Channel
          </div>
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="px-4 py-2 text-left">Channel</th>
                <th className="px-4 py-2 text-right">Count</th>
                <th className="px-4 py-2 text-left w-32">%</th>
              </tr>
            </thead>
            <tbody>
              {analytics.byChannel.length === 0 ? (
                <tr>
                  <td colSpan={3} className="px-4 py-4 text-center text-slate-400">No data</td>
                </tr>
              ) : (
                analytics.byChannel.map((row) => (
                  <tr key={row.channel} className="border-t border-slate-100">
                    <td className="px-4 py-2 capitalize text-slate-800">{row.channel.replace(/_/g, " ")}</td>
                    <td className="px-4 py-2 text-right text-slate-700">{row.count.toLocaleString("en-IN")}</td>
                    <td className="px-4 py-2">
                      <div className="flex items-center gap-2">
                        <div className="h-2 rounded-full bg-orange-200" style={{ width: `${Math.min(row.pct, 100)}%`, minWidth: "4px" }} />
                        <span className="text-xs text-slate-500">{row.pct.toFixed(1)}%</span>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </section>
      </div>
    </PageShell>
  );
}
