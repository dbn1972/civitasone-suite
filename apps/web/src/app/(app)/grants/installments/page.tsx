import Link from "next/link";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { getGrantInstallments } from "../../../_data/loaders";

const statusColors: Record<string, string> = {
  pending: "bg-amber-50 text-amber-700",
  released: "bg-blue-50 text-blue-700",
  utilized: "bg-emerald-50 text-emerald-700",
};

export default async function GrantInstallmentsPage() {
  const { data: installments, source } = await getGrantInstallments();

  const pending = installments.filter((i) => i.status === "pending").length;
  const released = installments.filter((i) => i.status === "released").length;
  const totalAmount = installments.reduce((sum, i) => sum + i.amount, 0);

  return (
    <main className="min-h-screen bg-slate-50 p-6 md:p-8">
      <section className="mx-auto max-w-7xl space-y-5">
        <nav aria-label="Breadcrumb" className="text-sm text-slate-600">
          <Link href="/grants" className="hover:text-slate-900">Grants</Link>
          <span className="mx-2">/</span>
          <span className="text-slate-900">Installments</span>
        </nav>

        <header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-3xl font-semibold text-slate-900">Grant Installments</h1>
            <p className="mt-1 text-sm text-slate-600">Disbursement schedule and release status for all grants.</p>
          </div>
          {source === "error" ? <DataSourceBadge source={source} /> : null}
        </header>

        <section className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Total Installments</p>
            <p className="mt-1 text-2xl font-bold text-slate-900">{installments.length}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Pending</p>
            <p className="mt-1 text-2xl font-bold text-amber-600">{pending}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Released</p>
            <p className="mt-1 text-2xl font-bold text-blue-600">{released}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Total Amount (₹)</p>
            <p className="mt-1 text-2xl font-bold text-slate-900">₹{(totalAmount / 100).toLocaleString("en-IN")}</p>
          </div>
        </section>

        <section className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-slate-100 text-slate-700">
              <tr>
                <th className="px-4 py-3">Grant No</th>
                <th className="px-4 py-3">Grantee</th>
                <th className="px-4 py-3 text-right">Installment No</th>
                <th className="px-4 py-3 text-right">Amount (₹)</th>
                <th className="px-4 py-3">Scheduled Date</th>
                <th className="px-4 py-3">Released Date</th>
                <th className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {installments.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-slate-400">No installments found</td>
                </tr>
              ) : (
                installments.map((i) => (
                  <tr key={i.id} className="border-t border-slate-200 hover:bg-slate-50">
                    <td className="px-4 py-3 font-mono text-xs">
                      <Link href={`/grants/${i.grantId}`} className="text-indigo-600 hover:underline">{i.grantNo}</Link>
                    </td>
                    <td className="px-4 py-3 text-slate-800">{i.granteeName}</td>
                    <td className="px-4 py-3 text-right text-slate-700">{i.installmentNo}</td>
                    <td className="px-4 py-3 text-right text-slate-800">₹{(i.amount / 100).toLocaleString("en-IN")}</td>
                    <td className="px-4 py-3 text-slate-600">{i.scheduledDate}</td>
                    <td className="px-4 py-3 text-slate-600">{i.releasedDate ?? "—"}</td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2 py-1 text-xs font-medium ${statusColors[i.status] ?? "bg-slate-100 text-slate-600"}`}>
                        {i.status}
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
