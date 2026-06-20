import Link from "next/link";
import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { getProcurementPOById } from "../../../../_data/loaders";

const statusColors: Record<string, string> = {
  draft: "bg-slate-100 text-slate-600",
  approved: "bg-emerald-50 text-emerald-700",
  partial_grn: "bg-amber-50 text-amber-700",
  fully_received: "bg-blue-50 text-blue-700",
  cancelled: "bg-red-50 text-red-700",
};

const statusLabels: Record<string, string> = {
  draft: "Draft",
  approved: "Approved",
  partial_grn: "Partial GRN",
  fully_received: "Fully Received",
  cancelled: "Cancelled",
};

export default async function Page({ params }: { params: { id: string } }) {
  const { data: po, source } = await getProcurementPOById(params.id);

  return (
    <main className="min-h-screen bg-slate-50 p-6 md:p-8">
      <section className="mx-auto max-w-5xl space-y-5">
        <nav aria-label="Breadcrumb" className="text-sm text-slate-600">
          <Link href="/procurement" className="hover:text-slate-900">Procurement</Link>
          <span className="mx-2">/</span>
          <Link href="/procurement/orders" className="hover:text-slate-900">Purchase Orders</Link>
          <span className="mx-2">/</span>
          <span className="text-slate-900">{po?.poNo ?? params.id}</span>
        </nav>

        <header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <h1 className="text-3xl font-semibold text-slate-900">Purchase Order Detail</h1>
          {source === "error" ? <DataSourceBadge source={source} /> : null}
        </header>

        {po ? (
          <div className="space-y-5">
            <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
                <div>
                  <p className="text-xs text-slate-500">PO No</p>
                  <p className="mt-1 font-mono font-medium text-slate-900">{po.poNo}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500">Status</p>
                  <span className={`mt-1 inline-block rounded-full px-2 py-1 text-xs font-medium ${statusColors[po.status] ?? "bg-slate-100 text-slate-600"}`}>
                    {statusLabels[po.status] ?? po.status}
                  </span>
                </div>
                <div>
                  <p className="text-xs text-slate-500">Total Amount</p>
                  <p className="mt-1 font-semibold text-slate-900">₹{(po.totalAmount / 100).toLocaleString("en-IN")}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500">Vendor</p>
                  <p className="mt-1 text-slate-800">{po.vendor}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500">Order Date</p>
                  <p className="mt-1 text-slate-800">{po.orderDate}</p>
                </div>
                {po.deliveryDate && (
                  <div>
                    <p className="text-xs text-slate-500">Delivery Date</p>
                    <p className="mt-1 text-slate-800">{po.deliveryDate}</p>
                  </div>
                )}
              </div>
            </section>

            {po.lineItems.length > 0 && (
              <section className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
                <div className="border-b border-slate-100 px-4 py-3 text-sm font-semibold text-slate-800">Line Items</div>
                <table className="min-w-full text-left text-sm">
                  <thead className="bg-slate-100 text-slate-700">
                    <tr>
                      <th className="px-4 py-3">Item Code</th>
                      <th className="px-4 py-3">Item Name</th>
                      <th className="px-4 py-3 text-right">Ordered Qty</th>
                      <th className="px-4 py-3">Unit</th>
                      <th className="px-4 py-3 text-right">Unit Price (₹)</th>
                      <th className="px-4 py-3 text-right">Total (₹)</th>
                      <th className="px-4 py-3 text-right">GRN Qty</th>
                    </tr>
                  </thead>
                  <tbody>
                    {po.lineItems.map((item, i) => (
                      <tr key={i} className="border-t border-slate-200">
                        <td className="px-4 py-3 font-mono text-slate-600">{item.itemCode}</td>
                        <td className="px-4 py-3 text-slate-800">{item.itemName}</td>
                        <td className="px-4 py-3 text-right text-slate-800">{item.quantity}</td>
                        <td className="px-4 py-3 text-slate-600">{item.unit}</td>
                        <td className="px-4 py-3 text-right text-slate-800">₹{(item.unitPrice / 100).toLocaleString("en-IN")}</td>
                        <td className="px-4 py-3 text-right font-medium text-slate-900">₹{(item.totalPrice / 100).toLocaleString("en-IN")}</td>
                        <td className="px-4 py-3 text-right">
                          <span className={item.grnQty >= item.quantity ? "text-emerald-600 font-medium" : "text-amber-600 font-medium"}>
                            {item.grnQty}
                          </span>
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
            Purchase order not found
          </div>
        )}
      </section>
    </main>
  );
}
