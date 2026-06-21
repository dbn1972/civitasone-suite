import Link from "next/link";
import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { getFinanceSanctions } from "../../../../_data/loaders";

const statusColors: Record<string, string> = {
  approved: "bg-emerald-50 text-emerald-700",
  pending: "bg-amber-50 text-amber-700",
  rejected: "bg-red-50 text-red-700",
};

export default async function SanctionsPage() {
  const { data: sanctions, source } = await getFinanceSanctions();

  const approved = sanctions.filter((s) => s.status === "approved").length;
  const pending = sanctions.filter((s) => s.status === "pending").length;
  const totalAmount = sanctions.reduce((sum, s) => sum + s.amount, 0);

  return (
    <main className="min-h-screen bg-slate-50 p-6 md:p-8">
      <section className="mx-auto max-w-7xl space-y-5">
        <nav aria-label="Breadcrumb" className="text-sm text-slate-600">
          <Link href="/finance" className="hover:text-slate-900">Finance</Link>
          <span className="mx-2">/</span>
          <span className="text-slate-900">Sanctions</span>
        </nav>

        <header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-3xl font-semibold text-slate-900">Sanctions</h1>
            <p className="mt-1 text-sm text-slate-600">Government expenditure sanctions and approval status.</p>
          </div>
          <div className="flex items-center gap-2">
            {source === "error" ? <DataSourceBadge source={source} /> : null}
            <Link href="/finance/budget/sanctions/new" className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500">
              + New Sanction
            </Link>
          </div>
        </header>

        <section className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Total</p>
            <p className="mt-1 text-2xl font-bold text-slate-900">{sanctions.length}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Approved</p>
            <p className="mt-1 text-2xl font-bold text-emerald-600">{approved}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Pending</p>
            <p className="mt-1 text-2xl font-bold text-amber-600">{pending}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Total Amount</p>
            <p className="mt-1 text-2xl font-bold text-blue-600">₹{(totalAmount / 100).toLocaleString("en-IN")}</p>
          </div>
        </section>

        <section className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="min-w-full text-left text-sm" aria-label="Sanctions list">
            <thead className="bg-slate-100 text-slate-700">
              <tr>
                <th scope="col" className="px-4 py-3">Sanction No</th>
                <th scope="col" className="px-4 py-3">Subject</th>
                <th scope="col" className="px-4 py-3">Major Head</th>
                <th scope="col" className="px-4 py-3 text-right">Amount (₹)</th>
                <th scope="col" className="px-4 py-3">Sanctioned By</th>
                <th scope="col" className="px-4 py-3">Date</th>
                <th scope="col" className="px-4 py-3">Status</th>
                <th scope="col" className="px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {sanctions.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-slate-400">No sanctions found</td>
                </tr>
              ) : (
                sanctions.map((s) => (
                  <tr key={s.id} className="border-t border-slate-200 hover:bg-slate-50">
                    <td className="px-4 py-3 font-mono text-xs text-slate-900">{s.sanctionNo}</td>
                    <td className="px-4 py-3 text-slate-800">{s.subject}</td>
                    <td className="px-4 py-3 text-slate-600">{s.majorHead}</td>
                    <td className="px-4 py-3 text-right text-slate-800">₹{(s.amount / 100).toLocaleString("en-IN")}</td>
                    <td className="px-4 py-3 text-slate-700">{s.sanctionedBy}</td>
                    <td className="px-4 py-3 text-slate-600">{s.date}</td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2 py-1 text-xs font-medium ${statusColors[s.status] ?? "bg-slate-100 text-slate-600"}`}>
                        {s.status}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <Link href={`/finance/budget/sanctions/${s.id}`} className="text-indigo-600 hover:underline text-xs">View</Link>
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
