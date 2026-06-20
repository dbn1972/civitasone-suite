import Link from "next/link";
import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { getProcurementIndentById } from "../../../../_data/loaders";

const statusColors: Record<string, string> = {
  draft: "bg-slate-100 text-slate-600",
  pending_approval: "bg-amber-50 text-amber-700",
  approved: "bg-emerald-50 text-emerald-700",
  rejected: "bg-red-50 text-red-700",
  converted_to_po: "bg-blue-50 text-blue-700",
};

const statusLabels: Record<string, string> = {
  draft: "Draft",
  pending_approval: "Pending Approval",
  approved: "Approved",
  rejected: "Rejected",
  converted_to_po: "Converted to PO",
};

export default async function Page({ params }: { params: { id: string } }) {
  const { data: indent, source } = await getProcurementIndentById(params.id);

  return (
    <main className="min-h-screen bg-slate-50 p-6 md:p-8">
      <section className="mx-auto max-w-5xl space-y-5">
        <nav aria-label="Breadcrumb" className="text-sm text-slate-600">
          <Link href="/procurement" className="hover:text-slate-900">Procurement</Link>
          <span className="mx-2">/</span>
          <Link href="/procurement/indents" className="hover:text-slate-900">Indents</Link>
          <span className="mx-2">/</span>
          <span className="text-slate-900">{indent?.indentNo ?? params.id}</span>
        </nav>

        <header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <h1 className="text-3xl font-semibold text-slate-900">Indent Detail</h1>
          {source === "error" ? <DataSourceBadge source={source} /> : null}
        </header>

        {indent ? (
          <div className="space-y-5">
            <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
                <div>
                  <p className="text-xs text-slate-500">Indent No</p>
                  <p className="mt-1 font-mono font-medium text-slate-900">{indent.indentNo}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500">Status</p>
                  <span className={`mt-1 inline-block rounded-full px-2 py-1 text-xs font-medium ${statusColors[indent.status] ?? "bg-slate-100 text-slate-600"}`}>
                    {statusLabels[indent.status] ?? indent.status}
                  </span>
                </div>
                <div>
                  <p className="text-xs text-slate-500">Est. Amount</p>
                  <p className="mt-1 font-semibold text-slate-900">₹{(indent.estimatedAmount / 100).toLocaleString("en-IN")}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500">Department</p>
                  <p className="mt-1 text-slate-800">{indent.department}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500">Requested By</p>
                  <p className="mt-1 text-slate-800">{indent.requestedBy}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500">Request Date</p>
                  <p className="mt-1 text-slate-800">{indent.requestDate}</p>
                </div>
                {indent.requiredByDate && (
                  <div>
                    <p className="text-xs text-slate-500">Required By</p>
                    <p className="mt-1 text-slate-800">{indent.requiredByDate}</p>
                  </div>
                )}
              </div>
            </section>

            {indent.lineItems.length > 0 && (
              <section className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
                <div className="border-b border-slate-100 px-4 py-3 text-sm font-semibold text-slate-800">Line Items</div>
                <table className="min-w-full text-left text-sm">
                  <thead className="bg-slate-100 text-slate-700">
                    <tr>
                      <th className="px-4 py-3">Item Code</th>
                      <th className="px-4 py-3">Item Name</th>
                      <th className="px-4 py-3 text-right">Quantity</th>
                      <th className="px-4 py-3">Unit</th>
                      <th className="px-4 py-3 text-right">Est. Unit Price (₹)</th>
                      <th className="px-4 py-3 text-right">Total (₹)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {indent.lineItems.map((item, i) => (
                      <tr key={i} className="border-t border-slate-200">
                        <td className="px-4 py-3 font-mono text-slate-600">{item.itemCode}</td>
                        <td className="px-4 py-3 text-slate-800">{item.itemName}</td>
                        <td className="px-4 py-3 text-right text-slate-800">{item.quantity}</td>
                        <td className="px-4 py-3 text-slate-600">{item.unit}</td>
                        <td className="px-4 py-3 text-right text-slate-800">₹{(item.estimatedUnitPrice / 100).toLocaleString("en-IN")}</td>
                        <td className="px-4 py-3 text-right font-medium text-slate-900">₹{(item.totalPrice / 100).toLocaleString("en-IN")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            )}

            {indent.approvalTrail.length > 0 && (
              <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="mb-3 text-sm font-semibold text-slate-800">Approval Trail</div>
                <div className="space-y-3">
                  {indent.approvalTrail.map((step, i) => (
                    <div key={i} className="flex gap-3 items-start">
                      <div className="mt-1.5 h-2 w-2 flex-shrink-0 rounded-full bg-indigo-400" />
                      <div>
                        <p className="text-sm font-medium text-slate-800">
                          {step.actor} — <span className="font-normal text-slate-600">{step.action}</span>
                        </p>
                        <p className="text-xs text-slate-400">{step.timestamp}</p>
                        {step.remarks && <p className="mt-0.5 text-xs text-slate-500">{step.remarks}</p>}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </div>
        ) : (
          <div className="rounded-xl border border-slate-200 bg-white py-12 text-center text-slate-400 shadow-sm">
            Indent not found
          </div>
        )}
      </section>
    </main>
  );
}
