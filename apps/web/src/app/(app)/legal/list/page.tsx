import Link from "next/link";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { getLegalCases } from "../../../_data/loaders";

const typeColors: Record<string, string> = {
  civil: "bg-blue-50 text-blue-700",
  criminal: "bg-red-50 text-red-700",
  arbitration: "bg-orange-50 text-orange-700",
  tribunal: "bg-purple-50 text-purple-700",
  writ: "bg-yellow-50 text-yellow-700",
  appeal: "bg-slate-100 text-slate-600",
  other: "bg-slate-100 text-slate-600",
};

const statusColors: Record<string, string> = {
  active: "bg-emerald-50 text-emerald-700",
  disposed: "bg-slate-100 text-slate-600",
  stayed: "bg-yellow-50 text-yellow-700",
  transferred: "bg-blue-50 text-blue-700",
  dismissed: "bg-red-50 text-red-700",
  settled: "bg-teal-50 text-teal-700",
};

export default async function LegalCasesListPage() {
  const { data: items, source } = await getLegalCases();

  const today = new Date().toISOString().slice(0, 10);
  const weekEnd = new Date(Date.now() + 7 * 86400_000).toISOString().slice(0, 10);

  const total = items.length;
  const active = items.filter((i) => i.status === "active").length;
  const nextWeekHearings = items.filter((i) => i.nextHearingDate && i.nextHearingDate >= today && i.nextHearingDate <= weekEnd).length;
  const disposed = items.filter((i) => i.status === "disposed").length;

  return (
    <main className="min-h-screen bg-slate-50 p-6 md:p-8">
      <section className="mx-auto max-w-7xl space-y-5">
        <nav aria-label="Breadcrumb" className="text-sm text-slate-600">
          <Link href="/legal" className="hover:text-slate-900">Legal</Link>
          <span className="mx-2">/</span>
          <span className="text-slate-900">Cases</span>
        </nav>

        <header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-3xl font-semibold text-slate-900">Legal Cases</h1>
            <p className="mt-1 text-sm text-slate-600">All cases across courts, tribunals, and arbitration.</p>
          </div>
          {source === "error" ? <DataSourceBadge source={source} /> : null}
        </header>

        <section className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Total</p>
            <p className="mt-1 text-2xl font-bold text-slate-900">{total}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Active</p>
            <p className="mt-1 text-2xl font-bold text-green-600">{active}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Hearings This Week</p>
            <p className="mt-1 text-2xl font-bold text-orange-600">{nextWeekHearings}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Disposed</p>
            <p className="mt-1 text-2xl font-bold text-slate-500">{disposed}</p>
          </div>
        </section>

        <section className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table aria-label="Legal cases" className="min-w-full text-left text-sm">
            <thead className="bg-slate-100 text-slate-700">
              <tr>
                <th scope="col" className="px-4 py-3">Case No</th>
                <th scope="col" className="px-4 py-3">Title</th>
                <th scope="col" className="px-4 py-3">Court</th>
                <th scope="col" className="px-4 py-3">Type</th>
                <th scope="col" className="px-4 py-3">Filed Date</th>
                <th scope="col" className="px-4 py-3">Department</th>
                <th scope="col" className="px-4 py-3">Petitioner</th>
                <th scope="col" className="px-4 py-3">Respondent</th>
                <th scope="col" className="px-4 py-3">Advocate</th>
                <th scope="col" className="px-4 py-3">Next Hearing</th>
                <th scope="col" className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id} className="border-t border-slate-200 hover:bg-slate-50">
                  <td className="px-4 py-3 font-mono text-xs text-slate-700">
                    <Link href={`/legal/cases/${item.id}`} className="text-indigo-600 hover:underline">
                      {item.caseNo}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-slate-800 max-w-xs truncate">{item.title}</td>
                  <td className="px-4 py-3 text-slate-600">{item.court}</td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${typeColors[item.type] ?? "bg-slate-100 text-slate-600"}`}>
                      {item.type}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-600">{item.filedDate}</td>
                  <td className="px-4 py-3 text-slate-600">{item.department ?? "—"}</td>
                  <td className="px-4 py-3 text-slate-600">{item.petitioner ?? "—"}</td>
                  <td className="px-4 py-3 text-slate-600">{item.respondent ?? "—"}</td>
                  <td className="px-4 py-3 text-slate-600">{item.advocateName ?? "—"}</td>
                  <td className="px-4 py-3 text-slate-600">{item.nextHearingDate ?? "—"}</td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusColors[item.status] ?? "bg-slate-100 text-slate-600"}`}>
                      {item.status}
                    </span>
                  </td>
                </tr>
              ))}
              {items.length === 0 && source !== "error" && (
                <tr>
                  <td colSpan={11} className="px-4 py-10 text-center text-sm text-slate-500">
                    <span className="block font-medium text-slate-700">No cases yet</span>
                    <span className="mt-1 block text-slate-400">Legal cases will appear here once filed.</span>
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
