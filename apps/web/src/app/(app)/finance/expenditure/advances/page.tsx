import Link from "next/link";
import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { getFinanceAdvances } from "../../../../_data/loaders";

const statusColors: Record<string, string> = {
  active: "bg-blue-50 text-blue-700",
  adjusted: "bg-emerald-50 text-emerald-700",
  overdue: "bg-red-50 text-red-700",
  closed: "bg-slate-100 text-slate-600",
};

export default async function AdvancesPage() {
  const { data: advances, source } = await getFinanceAdvances();

  const active = advances.filter((a) => a.status === "active").length;
  const overdue = advances.filter((a) => a.status === "overdue").length;
  const totalBalance = advances.reduce((s, a) => s + a.balance, 0);

  return (
    <main className="min-h-screen bg-slate-50 p-6 md:p-8">
      <section className="mx-auto max-w-7xl space-y-5">
        <nav aria-label="Breadcrumb" className="text-sm text-slate-600">
          <Link href="/finance" className="hover:text-slate-900">Finance</Link>
          <span className="mx-2">/</span>
          <span className="text-slate-900">Advances</span>
        </nav>

        <header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-3xl font-semibold text-slate-900">Advances</h1>
            <p className="mt-1 text-sm text-slate-600">Employee and vendor advances with outstanding balance tracking.</p>
          </div>
          {source === "error" ? <DataSourceBadge source={source} /> : null}
        </header>

        <section className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Total Advances</p>
            <p className="mt-1 text-2xl font-bold text-slate-900">{advances.length}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Active</p>
            <p className="mt-1 text-2xl font-bold text-blue-600">{active}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Overdue</p>
            <p className="mt-1 text-2xl font-bold text-red-600">{overdue}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Outstanding Balance</p>
            <p className="mt-1 text-2xl font-bold text-slate-900">₹{(totalBalance / 100).toLocaleString("en-IN")}</p>
          </div>
        </section>

        <section className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-slate-100 text-slate-700">
              <tr>
                <th className="px-4 py-3">Advance No</th>
                <th className="px-4 py-3">Beneficiary</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3 text-right">Amount (₹)</th>
                <th className="px-4 py-3 text-right">Adjusted (₹)</th>
                <th className="px-4 py-3 text-right">Balance (₹)</th>
                <th className="px-4 py-3">Disbursed</th>
                <th className="px-4 py-3">Due</th>
                <th className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {advances.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-8 text-center text-slate-400">No advances found</td>
                </tr>
              ) : (
                advances.map((a) => (
                  <tr key={a.id} className="border-t border-slate-200 hover:bg-slate-50">
                    <td className="px-4 py-3 font-mono text-xs text-slate-900">{a.advanceNo}</td>
                    <td className="px-4 py-3 text-slate-800">{a.beneficiary}</td>
                    <td className="px-4 py-3 capitalize text-slate-600">{a.type}</td>
                    <td className="px-4 py-3 text-right text-slate-800">₹{(a.amount / 100).toLocaleString("en-IN")}</td>
                    <td className="px-4 py-3 text-right text-slate-700">₹{(a.adjustedAmount / 100).toLocaleString("en-IN")}</td>
                    <td className="px-4 py-3 text-right font-medium text-slate-900">₹{(a.balance / 100).toLocaleString("en-IN")}</td>
                    <td className="px-4 py-3 text-slate-600">{a.disbursedDate}</td>
                    <td className="px-4 py-3 text-slate-600">{a.dueDate ?? "—"}</td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2 py-1 text-xs font-medium ${statusColors[a.status]}`}>
                        {a.status}
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
