import Link from "next/link";
import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { getRFQById } from "../../../../_data/loaders";

const statusColors: Record<string, string> = {
  draft: "bg-slate-100 text-slate-600",
  issued: "bg-blue-50 text-blue-700",
  closed: "bg-slate-100 text-slate-500",
  cancelled: "bg-red-50 text-red-700",
  awarded: "bg-emerald-50 text-emerald-700",
};

export default async function Page({ params }: { params: { id: string } }) {
  const { data: rfq, source } = await getRFQById(params.id);

  return (
    <main className="min-h-screen bg-slate-50 p-6 md:p-8">
      <section className="mx-auto max-w-5xl space-y-5">
        <nav aria-label="Breadcrumb" className="text-sm text-slate-600">
          <Link href="/procurement" className="hover:text-slate-900">Procurement</Link>
          <span className="mx-2">/</span>
          <Link href="/procurement/rfq" className="hover:text-slate-900">RFQ</Link>
          <span className="mx-2">/</span>
          <span className="text-slate-900">{rfq?.rfqNo ?? params.id}</span>
        </nav>

        <header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <h1 className="text-3xl font-semibold text-slate-900">RFQ Detail</h1>
          {source === "error" ? <DataSourceBadge source={source} /> : null}
        </header>

        {rfq ? (
          <div className="space-y-5">
            <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="font-mono text-lg font-semibold text-slate-900">{rfq.rfqNo}</p>
                  <p className="mt-1 text-slate-700">{rfq.title}</p>
                  {rfq.description && <p className="mt-2 text-sm text-slate-500">{rfq.description}</p>}
                </div>
                <span className={`rounded-full px-3 py-1 text-xs font-medium whitespace-nowrap ${statusColors[rfq.status] ?? "bg-slate-100 text-slate-600"}`}>
                  {rfq.status}
                </span>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-4 border-t border-slate-100 pt-4 md:grid-cols-4">
                {rfq.indentRef && (
                  <div>
                    <p className="text-xs text-slate-500">Indent Ref</p>
                    <p className="mt-1 font-mono text-sm text-slate-800">{rfq.indentRef}</p>
                  </div>
                )}
                <div>
                  <p className="text-xs text-slate-500">Closing Date</p>
                  <p className="mt-1 text-sm text-slate-800">{rfq.closingDate}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500">Vendors Invited</p>
                  <p className="mt-1 text-sm font-medium text-slate-800">{rfq.vendorsInvited}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500">Responses</p>
                  <p className="mt-1 text-sm font-medium text-slate-800">{rfq.responsesReceived}</p>
                </div>
              </div>
            </section>

            {rfq.lineItems.length > 0 && (
              <section className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
                <div className="border-b border-slate-100 px-4 py-3 text-sm font-semibold text-slate-800">Line Items</div>
                <table className="min-w-full text-left text-sm" aria-label="RFQ line items">
                  <thead className="bg-slate-100 text-slate-700">
                    <tr>
                      <th scope="col" className="px-4 py-3">Item Name</th>
                      <th scope="col" className="px-4 py-3 text-right">Quantity</th>
                      <th scope="col" className="px-4 py-3">Unit</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rfq.lineItems.map((item, i) => (
                      <tr key={i} className="border-t border-slate-200">
                        <td className="px-4 py-3 text-slate-800">{item.itemName}</td>
                        <td className="px-4 py-3 text-right text-slate-800">{item.quantity}</td>
                        <td className="px-4 py-3 text-slate-600">{item.unit}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            )}

            {rfq.responses.length > 0 && (
              <section className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
                <div className="border-b border-slate-100 px-4 py-3 text-sm font-semibold text-slate-800">Vendor Responses</div>
                <table className="min-w-full text-left text-sm" aria-label="Vendor responses">
                  <thead className="bg-slate-100 text-slate-700">
                    <tr>
                      <th scope="col" className="px-4 py-3">Vendor Name</th>
                      <th scope="col" className="px-4 py-3 text-right">Bid Amount (₹)</th>
                      <th scope="col" className="px-4 py-3">Submitted At</th>
                      <th scope="col" className="px-4 py-3">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rfq.responses.map((resp, i) => (
                      <tr key={i} className="border-t border-slate-200">
                        <td className="px-4 py-3 text-slate-800">{resp.vendorName}</td>
                        <td className="px-4 py-3 text-right font-medium text-slate-900">₹{(resp.totalAmount / 100).toLocaleString("en-IN")}</td>
                        <td className="px-4 py-3 text-slate-600">{resp.submittedAt}</td>
                        <td className="px-4 py-3">
                          <span className="rounded-full bg-slate-100 px-2 py-1 text-xs text-slate-600">{resp.status}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            )}
          </div>
        ) : (
          <div className="rounded-xl border border-slate-200 bg-white py-12 text-center text-slate-400 shadow-sm">
            RFQ not found
          </div>
        )}
      </section>
    </main>
  );
}
