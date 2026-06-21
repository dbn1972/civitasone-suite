import Link from "next/link";
import { DataSourceBadge } from "../../../../../_components/DataSourceBadge";
import { getFinanceBillById } from "../../../../../_data/loaders";

const statusColors: Record<string, string> = {
  pending: "bg-amber-50 text-amber-700",
  approved: "bg-emerald-50 text-emerald-700",
  paid: "bg-blue-50 text-blue-700",
  rejected: "bg-red-50 text-red-700",
  under_review: "bg-purple-50 text-purple-700",
};

export default async function BillDetailPage({ params }: { params: { id: string } }) {
  const { data: bill, source } = await getFinanceBillById(params.id);

  return (
    <main className="min-h-screen bg-slate-50 p-6 md:p-8">
      <section className="mx-auto max-w-5xl space-y-5">
        <nav aria-label="Breadcrumb" className="text-sm text-slate-600">
          <Link href="/finance" className="hover:text-slate-900">Finance</Link>
          <span className="mx-2">/</span>
          <Link href="/finance/expenditure/bills" className="hover:text-slate-900">Bills</Link>
          <span className="mx-2">/</span>
          <span className="text-slate-900">{bill?.billNo ?? params.id}</span>
        </nav>

        <header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <h1 className="text-3xl font-semibold text-slate-900">Bill Detail</h1>
          {source === "error" ? <DataSourceBadge source={source} /> : null}
        </header>

        {bill ? (
          <div className="space-y-5">
            <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
                <div>
                  <p className="text-xs text-slate-500">Bill No</p>
                  <p className="mt-1 font-mono text-slate-900">{bill.billNo}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500">Vendor</p>
                  <p className="mt-1 text-slate-800">{bill.vendor}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500">Status</p>
                  <span className={`mt-1 inline-block rounded-full px-2 py-1 text-xs font-medium ${statusColors[bill.status]}`}>
                    {bill.status.replace("_", " ")}
                  </span>
                </div>
                <div>
                  <p className="text-xs text-slate-500">Amount</p>
                  <p className="mt-1 font-semibold text-slate-900">₹{(bill.amount / 100).toLocaleString("en-IN")}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500">PO Reference</p>
                  <p className="mt-1 text-slate-800">{bill.poRef ?? "—"}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500">GRN Reference</p>
                  <p className="mt-1 text-slate-800">{bill.grnRef ?? "—"}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500">Invoice No</p>
                  <p className="mt-1 text-slate-800">{bill.invoiceNo ?? "—"}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500">Submitted</p>
                  <p className="mt-1 text-slate-800">{bill.submittedDate}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500">3-Way Match</p>
                  <p className="mt-1 capitalize text-slate-800">{bill.threeWayMatch}</p>
                </div>
              </div>
            </section>

            {bill.lineItems.length > 0 && (
              <section className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
                <div className="border-b border-slate-100 px-4 py-3 text-sm font-semibold text-slate-800">Line Items</div>
                <table className="min-w-full text-left text-sm" aria-label="Bill line items">
                  <thead className="bg-slate-100 text-slate-700">
                    <tr>
                      <th scope="col" className="px-4 py-3">Description</th>
                      <th scope="col" className="px-4 py-3 text-right">Qty</th>
                      <th scope="col" className="px-4 py-3 text-right">Unit Price (₹)</th>
                      <th scope="col" className="px-4 py-3 text-right">Amount (₹)</th>
                      <th scope="col" className="px-4 py-3">Tax Code</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bill.lineItems.map((item: { description: string; quantity: number; unitPrice: number; amount: number; taxCode?: string }, i: number) => (
                      <tr key={i} className="border-t border-slate-200">
                        <td className="px-4 py-3 text-slate-800">{item.description}</td>
                        <td className="px-4 py-3 text-right text-slate-700">{item.quantity}</td>
                        <td className="px-4 py-3 text-right text-slate-700">₹{(item.unitPrice / 100).toLocaleString("en-IN")}</td>
                        <td className="px-4 py-3 text-right font-medium text-slate-800">₹{(item.amount / 100).toLocaleString("en-IN")}</td>
                        <td className="px-4 py-3 text-slate-500">{item.taxCode ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            )}
          </div>
        ) : (
          <div className="rounded-xl border border-slate-200 bg-white py-12 text-center text-slate-400 shadow-sm">
            Bill not found
          </div>
        )}
      </section>
    </main>
  );
}
