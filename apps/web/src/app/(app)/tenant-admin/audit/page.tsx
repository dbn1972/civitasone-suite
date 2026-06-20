import Link from "next/link";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { getTenantAuditLog } from "../../../_data/loaders";

const outcomeColors: Record<string, string> = {
  success: "bg-emerald-50 text-emerald-700",
  failure: "bg-red-50 text-red-700",
};

export default async function Page() {
  const { data: events, source } = await getTenantAuditLog();

  const total = events.length;
  const failures = events.filter((e) => e.outcome === "failure").length;
  const successes = events.filter((e) => e.outcome === "success").length;

  return (
    <main className="min-h-screen bg-slate-50 p-6 md:p-8">
      <section className="mx-auto max-w-7xl space-y-5">
        <nav aria-label="Breadcrumb" className="text-sm text-slate-600">
          <Link href="/tenant-admin" className="hover:text-slate-900">Tenant Admin</Link>
          <span className="mx-2">/</span>
          <span className="text-slate-900">Audit Log</span>
        </nav>

        <header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-3xl font-semibold text-slate-900">Audit Log</h1>
            <p className="mt-1 text-sm text-slate-600">Tenant-scoped audit events — all actor actions and outcomes.</p>
          </div>
          {source === "error" ? <DataSourceBadge source={source} /> : null}
        </header>

        <section className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Total Events</p>
            <p className="mt-1 text-2xl font-bold text-slate-900">{total}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Success</p>
            <p className="mt-1 text-2xl font-bold text-emerald-600">{successes}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Failures</p>
            <p className="mt-1 text-2xl font-bold text-red-600">{failures}</p>
          </div>
        </section>

        <section className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-slate-100 text-slate-700">
              <tr>
                <th className="px-4 py-3">Actor</th>
                <th className="px-4 py-3">Action</th>
                <th className="px-4 py-3">Resource</th>
                <th className="px-4 py-3">Outcome</th>
                <th className="px-4 py-3">Timestamp</th>
                <th className="px-4 py-3">IP Address</th>
              </tr>
            </thead>
            <tbody>
              {events.map((event) => (
                <tr key={event.id} className="border-t border-slate-200 hover:bg-slate-50">
                  <td className="px-4 py-3 text-slate-800">{event.actor}</td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-700">{event.action}</td>
                  <td className="px-4 py-3 text-slate-600">{event.resource ?? "—"}</td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium capitalize ${outcomeColors[event.outcome] ?? "bg-slate-100 text-slate-600"}`}>
                      {event.outcome}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-600">{event.timestamp.slice(0, 16).replace("T", " ")}</td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-600">{event.ipAddress ?? "—"}</td>
                </tr>
              ))}
              {events.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-sm text-slate-400">No audit events found.</td>
                </tr>
              )}
            </tbody>
          </table>
        </section>
      </section>
    </main>
  );
}
