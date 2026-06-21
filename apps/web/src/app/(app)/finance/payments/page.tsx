import Link from "next/link";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { getPayments } from "../../../_data/loaders";

const statusColors: Record<string, string> = {
  Queued: "bg-slate-100 text-slate-600",
  Released: "bg-emerald-50 text-emerald-700",
  "Pending Approval": "bg-amber-50 text-amber-700",
  Failed: "bg-red-50 text-red-700",
};

export default async function Page() {
  const { data: payments, source } = await getPayments();

  return (
    <main className="min-h-screen bg-slate-50 p-6 md:p-8">
      <section className="mx-auto max-w-7xl space-y-5">
        <nav aria-label="Breadcrumb" className="text-sm text-slate-600">
          <Link href="/finance" className="hover:text-slate-900">Finance</Link>
          <span className="mx-2">/</span>
          <span className="text-slate-900">Payments</span>
        </nav>

        <header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-3xl font-semibold text-slate-900">Payments</h1>
            <p className="mt-1 text-sm text-slate-600">Outgoing and incoming payment lifecycle tracking.</p>
          </div>
          {source === "error" ? <DataSourceBadge source={source} /> : null}
        </header>

        <section className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Total Payments</p>
            <p className="mt-1 text-2xl font-bold text-slate-900">{payments.length}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Released</p>
            <p className="mt-1 text-2xl font-bold text-emerald-600">
              {payments.filter((p) => p.status === "Released").length}
            </p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Pending Approval</p>
            <p className="mt-1 text-2xl font-bold text-amber-600">
              {payments.filter((p) => p.status === "Pending Approval").length}
            </p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Failed</p>
            <p className="mt-1 text-2xl font-bold text-red-600">
              {payments.filter((p) => p.status === "Failed").length}
            </p>
          </div>
        </section>

        <section className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="min-w-full text-left text-sm" aria-label="Payments list">
            <thead className="bg-slate-100 text-slate-700">
              <tr>
                <th scope="col" className="px-4 py-3">Reference</th>
                <th scope="col" className="px-4 py-3">Beneficiary</th>
                <th scope="col" className="px-4 py-3 text-right">Amount</th>
                <th scope="col" className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {payments.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-10 text-center text-slate-400">
                    No payments found
                  </td>
                </tr>
              ) : (
                payments.map((payment) => (
                  <tr key={payment.referenceId} className="border-t border-slate-200 hover:bg-slate-50">
                    <td className="px-4 py-3 font-mono text-xs text-slate-700">{payment.referenceId}</td>
                    <td className="px-4 py-3 text-slate-800">{payment.beneficiary}</td>
                    <td className="px-4 py-3 text-right font-medium text-slate-900">{payment.amountDisplay}</td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2 py-1 text-xs font-medium ${statusColors[payment.status] ?? "bg-slate-100 text-slate-600"}`}>
                        {payment.status}
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
