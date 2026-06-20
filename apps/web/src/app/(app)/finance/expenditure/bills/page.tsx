import Link from "next/link";
import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { getFinanceBills } from "../../../../_data/loaders";

const statusColors: Record<string, string> = {
  pending: "bg-amber-50 text-amber-700",
  approved: "bg-emerald-50 text-emerald-700",
  paid: "bg-blue-50 text-blue-700",
  rejected: "bg-red-50 text-red-700",
  under_review: "bg-purple-50 text-purple-700",
};

const matchColors: Record<string, string> = {
  matched: "bg-emerald-50 text-emerald-700",
  partial: "bg-amber-50 text-amber-700",
  unmatched: "bg-red-50 text-red-700",
  na: "bg-slate-100 text-slate-500",
};

export default async function BillsPage() {
  const { data: bills, source } = await getFinanceBills();

  const pending = bills.filter((b) => b.status === "pending").length;
  const paid = bills.filter((b) => b.status === "paid").length;
  const totalAmount = bills.reduce((s, b) => s + b.amount, 0);

  return (
    <main className="min-h-screen bg-slate-50 p-6 md:p-8">
      <section className="mx-auto max-w-7xl space-y-5">
        <nav aria-label="Breadcrumb" className="text-sm text-slate-600">
          <Link href="/finance" className="hover:text-slate-900">Finance</Link>
          <span className="mx-2">/</span>
          <span className="text-slate-900">Bill Processing</span>
        </nav>

        <header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-3xl font-semibold text-slate-900">Bill Processing</h1>
            <p className="mt-1 text-sm text-slate-600">Vendor bills with 3-way match and payment status.</p>
          </div>
          {source === "error" ? <DataSourceBadge source={source} /> : null}
        </header>

        <section className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Total Bills</p>
            <p className="mt-1 text-2xl font-bold text-slate-900">{bills.length}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Pending</p>
            <p className="mt-1 text-2xl font-bold text-amber-600">{pending}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Paid</p>
            <p className="mt-1 text-2xl font-bold text-blue-600">{paid}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Total Value</p>
            <p className="mt-1 text-2xl font-bold text-slate-900">₹{(totalAmount / 100).toLocaleString("en-IN")}</p>
          </div>
        </section>

        <section className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-slate-100 text-slate-700">
              <tr>
                <th className="px-4 py-3">Bill No</th>
                <th className="px-4 py-3">Vendor</th>
                <th className="px-4 py-3">PO Ref</th>
                <th className="px-4 py-3 text-right">Amount (₹)</th>
                <th className="px-4 py-3">Submitted</th>
                <th className="px-4 py-3">Due</th>
                <th className="px-4 py-3">3-Way Match</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {bills.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-8 text-center text-slate-400">No bills found</td>
                </tr>
              ) : (
                bills.map((b) => (
                  <tr key={b.id} className="border-t border-slate-200 hover:bg-slate-50">
                    <td className="px-4 py-3 font-mono text-xs text-slate-900">{b.billNo}</td>
                    <td className="px-4 py-3 text-slate-800">{b.vendor}</td>
                    <td className="px-4 py-3 text-slate-500">{b.poRef ?? "—"}</td>
                    <td className="px-4 py-3 text-right text-slate-800">₹{(b.amount / 100).toLocaleString("en-IN")}</td>
                    <td className="px-4 py-3 text-slate-600">{b.submittedDate}</td>
                    <td className="px-4 py-3 text-slate-600">{b.dueDate ?? "—"}</td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2 py-1 text-xs ${matchColors[b.threeWayMatch]}`}>
                        {b.threeWayMatch}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2 py-1 text-xs font-medium ${statusColors[b.status]}`}>
                        {b.status.replace("_", " ")}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <Link href={`/finance/expenditure/bills/${b.id}`} className="text-indigo-600 hover:underline text-xs">View</Link>
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
