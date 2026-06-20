import Link from "next/link";
import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { getFinanceUCs } from "../../../../_data/loaders";

const statusColors: Record<string, string> = {
  pending: "bg-amber-50 text-amber-700",
  submitted: "bg-blue-50 text-blue-700",
  verified: "bg-emerald-50 text-emerald-700",
  rejected: "bg-red-50 text-red-700",
};

export default async function UCsPage() {
  const { data: ucs, source } = await getFinanceUCs();

  const pending = ucs.filter((u) => u.status === "pending").length;
  const verified = ucs.filter((u) => u.status === "verified").length;
  const totalAmount = ucs.reduce((s, u) => s + u.amount, 0);

  return (
    <main className="min-h-screen bg-slate-50 p-6 md:p-8">
      <section className="mx-auto max-w-7xl space-y-5">
        <nav aria-label="Breadcrumb" className="text-sm text-slate-600">
          <Link href="/finance" className="hover:text-slate-900">Finance</Link>
          <span className="mx-2">/</span>
          <span className="text-slate-900">Utilization Certificates</span>
        </nav>

        <header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-3xl font-semibold text-slate-900">Utilization Certificates</h1>
            <p className="mt-1 text-sm text-slate-600">Grant utilization certificates submitted by grantees.</p>
          </div>
          {source === "error" ? <DataSourceBadge source={source} /> : null}
        </header>

        <section className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Total UCs</p>
            <p className="mt-1 text-2xl font-bold text-slate-900">{ucs.length}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Pending</p>
            <p className="mt-1 text-2xl font-bold text-amber-600">{pending}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Verified</p>
            <p className="mt-1 text-2xl font-bold text-emerald-600">{verified}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Total Amount</p>
            <p className="mt-1 text-2xl font-bold text-slate-900">₹{(totalAmount / 100).toLocaleString("en-IN")}</p>
          </div>
        </section>

        <section className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-slate-100 text-slate-700">
              <tr>
                <th className="px-4 py-3">UC No</th>
                <th className="px-4 py-3">Grantee</th>
                <th className="px-4 py-3">Grant Ref</th>
                <th className="px-4 py-3 text-right">Amount (₹)</th>
                <th className="px-4 py-3">Period</th>
                <th className="px-4 py-3">Submitted</th>
                <th className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {ucs.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-slate-400">No utilization certificates found</td>
                </tr>
              ) : (
                ucs.map((u) => (
                  <tr key={u.id} className="border-t border-slate-200 hover:bg-slate-50">
                    <td className="px-4 py-3 font-mono text-xs text-slate-900">{u.ucNo}</td>
                    <td className="px-4 py-3 text-slate-800">{u.grantee}</td>
                    <td className="px-4 py-3 text-slate-500">{u.grantRef ?? "—"}</td>
                    <td className="px-4 py-3 text-right text-slate-800">₹{(u.amount / 100).toLocaleString("en-IN")}</td>
                    <td className="px-4 py-3 text-slate-600">{u.periodFrom} – {u.periodTo}</td>
                    <td className="px-4 py-3 text-slate-600">{u.submittedDate ?? "—"}</td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2 py-1 text-xs font-medium ${statusColors[u.status]}`}>
                        {u.status}
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
