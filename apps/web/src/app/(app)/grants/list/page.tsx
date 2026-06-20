import Link from "next/link";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { getGrants } from "../../../_data/loaders";

const statusColors: Record<string, string> = {
  active: "bg-emerald-50 text-emerald-700",
  completed: "bg-blue-50 text-blue-700",
  suspended: "bg-amber-50 text-amber-700",
  cancelled: "bg-red-50 text-red-700",
};

export default async function GrantsListPage() {
  const { data: grants, source } = await getGrants();

  const active = grants.filter((g) => g.status === "active").length;
  const totalDisbursed = grants.reduce((sum, g) => sum + g.disbursedAmount, 0);
  const totalPending = grants.reduce((sum, g) => sum + g.pendingAmount, 0);

  return (
    <main className="min-h-screen bg-slate-50 p-6 md:p-8">
      <section className="mx-auto max-w-7xl space-y-5">
        <nav aria-label="Breadcrumb" className="text-sm text-slate-600">
          <Link href="/grants" className="hover:text-slate-900">Grants</Link>
          <span className="mx-2">/</span>
          <span className="text-slate-900">Grants List</span>
        </nav>

        <header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-3xl font-semibold text-slate-900">Grants</h1>
            <p className="mt-1 text-sm text-slate-600">All grants with disbursement and status tracking.</p>
          </div>
          {source === "error" ? <DataSourceBadge source={source} /> : null}
        </header>

        <section className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Total</p>
            <p className="mt-1 text-2xl font-bold text-slate-900">{grants.length}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Active</p>
            <p className="mt-1 text-2xl font-bold text-emerald-600">{active}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Total Disbursed (₹)</p>
            <p className="mt-1 text-2xl font-bold text-blue-600">₹{(totalDisbursed / 100).toLocaleString("en-IN")}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Pending (₹)</p>
            <p className="mt-1 text-2xl font-bold text-amber-600">₹{(totalPending / 100).toLocaleString("en-IN")}</p>
          </div>
        </section>

        <section className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-slate-100 text-slate-700">
              <tr>
                <th className="px-4 py-3">Grant No</th>
                <th className="px-4 py-3">Title</th>
                <th className="px-4 py-3">Grantee</th>
                <th className="px-4 py-3 text-right">Total Amount (₹)</th>
                <th className="px-4 py-3 text-right">Disbursed (₹)</th>
                <th className="px-4 py-3 text-right">Pending (₹)</th>
                <th className="px-4 py-3">Sanction Date</th>
                <th className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {grants.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-slate-400">No grants found</td>
                </tr>
              ) : (
                grants.map((g) => (
                  <tr key={g.id} className="border-t border-slate-200 hover:bg-slate-50">
                    <td className="px-4 py-3 font-mono text-xs">
                      <Link href={`/grants/${g.id}`} className="text-indigo-600 hover:underline">{g.grantNo}</Link>
                    </td>
                    <td className="px-4 py-3 text-slate-800 max-w-xs truncate">{g.title}</td>
                    <td className="px-4 py-3 text-slate-600">{g.granteeName ?? "—"}</td>
                    <td className="px-4 py-3 text-right text-slate-800">₹{(g.totalAmount / 100).toLocaleString("en-IN")}</td>
                    <td className="px-4 py-3 text-right text-slate-800">₹{(g.disbursedAmount / 100).toLocaleString("en-IN")}</td>
                    <td className="px-4 py-3 text-right text-slate-800">₹{(g.pendingAmount / 100).toLocaleString("en-IN")}</td>
                    <td className="px-4 py-3 text-slate-600">{g.sanctionDate}</td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2 py-1 text-xs font-medium ${statusColors[g.status] ?? "bg-slate-100 text-slate-600"}`}>
                        {g.status}
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
