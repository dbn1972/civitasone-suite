import Link from "next/link";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { getLegalHearings } from "../../../_data/loaders";

const statusColors: Record<string, string> = {
  scheduled: "bg-blue-50 text-blue-700",
  completed: "bg-emerald-50 text-emerald-700",
  adjourned: "bg-yellow-50 text-yellow-700",
  cancelled: "bg-red-50 text-red-700",
};

export default async function LegalHearingsPage() {
  const { data: items, source } = await getLegalHearings();

  const today = new Date().toISOString().slice(0, 10);
  const weekEnd = new Date(Date.now() + 7 * 86400_000).toISOString().slice(0, 10);

  const total = items.length;
  const scheduled = items.filter((i) => i.status === "scheduled" && i.date >= today).length;
  const thisWeek = items.filter((i) => i.date >= today && i.date <= weekEnd).length;
  const completed = items.filter((i) => i.status === "completed").length;

  const sorted = [...items].sort((a, b) => a.date.localeCompare(b.date));

  return (
    <main className="min-h-screen bg-slate-50 p-6 md:p-8">
      <section className="mx-auto max-w-7xl space-y-5">
        <nav aria-label="Breadcrumb" className="text-sm text-slate-600">
          <Link href="/legal" className="hover:text-slate-900">Legal</Link>
          <span className="mx-2">/</span>
          <span className="text-slate-900">Hearings</span>
        </nav>

        <header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-3xl font-semibold text-slate-900">Hearings</h1>
            <p className="mt-1 text-sm text-slate-600">Upcoming and past court hearings across all cases.</p>
          </div>
          {source === "error" ? <DataSourceBadge source={source} /> : null}
        </header>

        <section className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Total</p>
            <p className="mt-1 text-2xl font-bold text-slate-900">{total}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Scheduled (Future)</p>
            <p className="mt-1 text-2xl font-bold text-blue-600">{scheduled}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">This Week</p>
            <p className="mt-1 text-2xl font-bold text-orange-600">{thisWeek}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Completed</p>
            <p className="mt-1 text-2xl font-bold text-green-600">{completed}</p>
          </div>
        </section>

        <section className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-slate-100 text-slate-700">
              <tr>
                <th className="px-4 py-3">Case No</th>
                <th className="px-4 py-3">Case Title</th>
                <th className="px-4 py-3">Court</th>
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3">Time</th>
                <th className="px-4 py-3">Purpose</th>
                <th className="px-4 py-3">Outcome</th>
                <th className="px-4 py-3">Next Date</th>
                <th className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((item) => (
                <tr key={item.id} className="border-t border-slate-200 hover:bg-slate-50">
                  <td className="px-4 py-3 font-mono text-xs text-slate-700">
                    <Link href={`/legal/cases/${item.caseId}`} className="text-indigo-600 hover:underline">
                      {item.caseNo}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-slate-800 max-w-xs truncate">{item.caseTitle}</td>
                  <td className="px-4 py-3 text-slate-600">{item.court}</td>
                  <td className="px-4 py-3 text-slate-800">{item.date}</td>
                  <td className="px-4 py-3 text-slate-600">{item.time ?? "—"}</td>
                  <td className="px-4 py-3 text-slate-600">{item.purpose ?? "—"}</td>
                  <td className="px-4 py-3 text-slate-600">{item.outcome ?? "—"}</td>
                  <td className="px-4 py-3 text-slate-600">{item.nextDate ?? "—"}</td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusColors[item.status] ?? "bg-slate-100 text-slate-600"}`}>
                      {item.status}
                    </span>
                  </td>
                </tr>
              ))}
              {items.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-4 py-8 text-center text-sm text-slate-400">No hearings found.</td>
                </tr>
              )}
            </tbody>
          </table>
        </section>
      </section>
    </main>
  );
}
