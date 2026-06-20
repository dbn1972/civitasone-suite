import Link from "next/link";
import { DataSourceBadge } from "../../../../../_components/DataSourceBadge";
import { getFinanceSanctionById } from "../../../../../_data/loaders";

const statusColors: Record<string, string> = {
  approved: "bg-emerald-50 text-emerald-700",
  pending: "bg-amber-50 text-amber-700",
  rejected: "bg-red-50 text-red-700",
};

export default async function SanctionDetailPage({ params }: { params: { id: string } }) {
  const { data: sanction, source } = await getFinanceSanctionById(params.id);

  return (
    <main className="min-h-screen bg-slate-50 p-6 md:p-8">
      <section className="mx-auto max-w-5xl space-y-5">
        <nav aria-label="Breadcrumb" className="text-sm text-slate-600">
          <Link href="/finance" className="hover:text-slate-900">Finance</Link>
          <span className="mx-2">/</span>
          <Link href="/finance/budget/sanctions" className="hover:text-slate-900">Sanctions</Link>
          <span className="mx-2">/</span>
          <span className="text-slate-900">{sanction?.sanctionNo ?? params.id}</span>
        </nav>

        <header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <h1 className="text-3xl font-semibold text-slate-900">Sanction Detail</h1>
          {source === "error" ? <DataSourceBadge source={source} /> : null}
        </header>

        {sanction ? (
          <div className="space-y-5">
            <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
                <div>
                  <p className="text-xs text-slate-500">Sanction No</p>
                  <p className="mt-1 font-mono font-medium text-slate-900">{sanction.sanctionNo}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500">Status</p>
                  <span className={`mt-1 inline-block rounded-full px-2 py-1 text-xs font-medium ${statusColors[sanction.status] ?? "bg-slate-100 text-slate-600"}`}>
                    {sanction.status}
                  </span>
                </div>
                <div>
                  <p className="text-xs text-slate-500">Amount</p>
                  <p className="mt-1 font-semibold text-slate-900">₹{(sanction.amount / 100).toLocaleString("en-IN")}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500">Major Head</p>
                  <p className="mt-1 text-slate-800">{sanction.majorHead}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500">Sanctioned By</p>
                  <p className="mt-1 text-slate-800">{sanction.sanctionedBy}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500">Date</p>
                  <p className="mt-1 text-slate-800">{sanction.date}</p>
                </div>
              </div>
              {sanction.remarks && (
                <div className="mt-4 border-t border-slate-100 pt-4">
                  <p className="text-xs text-slate-500">Remarks</p>
                  <p className="mt-1 text-sm text-slate-700">{sanction.remarks}</p>
                </div>
              )}
            </section>

            {sanction.lineItems.length > 0 && (
              <section className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
                <div className="border-b border-slate-100 px-4 py-3 text-sm font-semibold text-slate-800">Line Items</div>
                <table className="min-w-full text-left text-sm">
                  <thead className="bg-slate-100 text-slate-700">
                    <tr>
                      <th className="px-4 py-3">Description</th>
                      <th className="px-4 py-3">Head</th>
                      <th className="px-4 py-3 text-right">Amount (₹)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sanction.lineItems.map((item: { description: string; amount: number; head: string }, i: number) => (
                      <tr key={i} className="border-t border-slate-200">
                        <td className="px-4 py-3 text-slate-800">{item.description}</td>
                        <td className="px-4 py-3 text-slate-600">{item.head}</td>
                        <td className="px-4 py-3 text-right text-slate-800">₹{(item.amount / 100).toLocaleString("en-IN")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            )}

            {sanction.approvalTrail.length > 0 && (
              <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="mb-3 text-sm font-semibold text-slate-800">Approval Trail</div>
                <div className="space-y-3">
                  {sanction.approvalTrail.map((step: { actor: string; action: string; timestamp: string }, i: number) => (
                    <div key={i} className="flex gap-3 items-start">
                      <div className="mt-1.5 h-2 w-2 flex-shrink-0 rounded-full bg-indigo-400" />
                      <div>
                        <p className="text-sm font-medium text-slate-800">{step.actor} — <span className="font-normal text-slate-600">{step.action}</span></p>
                        <p className="text-xs text-slate-400">{step.timestamp}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </div>
        ) : (
          <div className="rounded-xl border border-slate-200 bg-white py-12 text-center text-slate-400 shadow-sm">
            Sanction not found
          </div>
        )}
      </section>
    </main>
  );
}
