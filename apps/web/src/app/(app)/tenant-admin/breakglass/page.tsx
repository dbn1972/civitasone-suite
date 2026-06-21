import Link from "next/link";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { getBreakglassLog } from "../../../_data/loaders";

const statusColors: Record<string, string> = {
  active: "bg-red-100 text-red-800 font-semibold",
  ended: "bg-slate-100 text-slate-600",
  auto_expired: "bg-yellow-50 text-yellow-700",
};

export default async function Page() {
  const { data: events, source } = await getBreakglassLog();

  const total = events.length;
  const activeNow = events.filter((e) => e.status === "active").length;
  const ended = events.filter((e) => e.status === "ended").length;
  const thisMonth = events.filter((e) => {
    const d = new Date(e.startedAt);
    const now = new Date();
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
  }).length;

  return (
    <main className="min-h-screen bg-slate-50 p-6 md:p-8">
      <section className="mx-auto max-w-7xl space-y-5">
        <nav aria-label="Breadcrumb" className="text-sm text-slate-600">
          <Link href="/tenant-admin" className="hover:text-slate-900">Tenant Admin</Link>
          <span className="mx-2">/</span>
          <span className="text-slate-900">Break-Glass Log</span>
        </nav>

        <header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-3xl font-semibold text-slate-900">Break-Glass Access Log</h1>
            <p className="mt-1 text-sm text-slate-600">Emergency support access events — all instances require justification and are fully audited.</p>
          </div>
          {source === "error" ? <DataSourceBadge source={source} /> : null}
        </header>

        {activeNow > 0 ? (
          <div className="rounded-xl border border-red-300 bg-red-50 px-5 py-4">
            <p className="text-sm font-semibold text-red-800">
              {activeNow} active break-glass session{activeNow > 1 ? "s" : ""} in progress.
            </p>
          </div>
        ) : null}

        <section className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Total Events</p>
            <p className="mt-1 text-2xl font-bold text-slate-900">{total}</p>
          </div>
          <div className="rounded-xl border border-red-200 bg-red-50 p-4 shadow-sm">
            <p className="text-sm text-red-600">Active Now</p>
            <p className="mt-1 text-2xl font-bold text-red-700">{activeNow}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Ended</p>
            <p className="mt-1 text-2xl font-bold text-slate-600">{ended}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">This Month</p>
            <p className="mt-1 text-2xl font-bold text-slate-900">{thisMonth}</p>
          </div>
        </section>

        <section className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table aria-label="Break-glass access log" className="min-w-full text-left text-sm">
            <thead className="bg-slate-100 text-slate-700">
              <tr>
                <th scope="col" className="px-4 py-3">Actor</th>
                <th scope="col" className="px-4 py-3">Actor Email</th>
                <th scope="col" className="px-4 py-3">Reason</th>
                <th scope="col" className="px-4 py-3">Resource Accessed</th>
                <th scope="col" className="px-4 py-3">Started At</th>
                <th scope="col" className="px-4 py-3">Ended At</th>
                <th scope="col" className="px-4 py-3">Approved By</th>
                <th scope="col" className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {events.map((event) => (
                <tr key={event.id} className="border-t border-slate-200 hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium text-slate-900">{event.actor}</td>
                  <td className="px-4 py-3 text-slate-600">{event.actorEmail}</td>
                  <td className="px-4 py-3 max-w-xs truncate text-slate-700">{event.reason}</td>
                  <td className="px-4 py-3 text-slate-600">{event.resourceAccessed ?? "—"}</td>
                  <td className="px-4 py-3 text-slate-600">{event.startedAt.slice(0, 16).replace("T", " ")}</td>
                  <td className="px-4 py-3 text-slate-600">{event.endedAt ? event.endedAt.slice(0, 16).replace("T", " ") : "—"}</td>
                  <td className="px-4 py-3 text-slate-600">{event.approvedBy ?? "—"}</td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2 py-0.5 text-xs capitalize ${statusColors[event.status] ?? "bg-slate-100 text-slate-600"}`}>
                      {event.status.replace(/_/g, " ")}
                    </span>
                  </td>
                </tr>
              ))}
              {events.length === 0 && source !== "error" && (
                <tr>
                  <td colSpan={8} className="px-4 py-10 text-center text-sm text-slate-500">
                    <span className="block font-medium text-slate-700">No break-glass events</span>
                    <span className="mt-1 block text-slate-400">Emergency support access events will appear here if invoked.</span>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </section>
      </section>
    </main>
  );
}
