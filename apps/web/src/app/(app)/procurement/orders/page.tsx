import Link from "next/link";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { PageShell } from "../../../_components/PageShell";
import { getProcurementPOs } from "../../../_data/loaders";

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

export default async function Page({ searchParams }: { searchParams: { vendor?: string } }) {
  const { data: orders, source } = await getProcurementPOs();
  const vendorFilter = searchParams.vendor ?? "";

  const filtered = vendorFilter
    ? orders.filter((o) => o.vendor.toLowerCase().includes(vendorFilter.toLowerCase()))
    : orders;

  const vendors = [...new Set(orders.map((o) => o.vendor))].sort();

  return (
    <PageShell title="Purchase Orders" description="Operational order book with GRN status and delivery tracking.">
      <nav aria-label="Breadcrumb" className="text-sm text-slate-600">
        <Link href="/procurement" className="hover:text-slate-900">Procurement</Link>
        <span className="mx-2">/</span>
        <span className="text-slate-900">Purchase Orders</span>
      </nav>

      {source === "error" ? <DataSourceBadge source={source} /> : null}

      <form method="GET" className="flex items-center gap-3">
        <label htmlFor="vendor-filter" className="text-sm text-slate-600">Filter by Vendor</label>
        <select
          id="vendor-filter"
          name="vendor"
          defaultValue={vendorFilter}
          className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-800 shadow-sm focus:border-indigo-400 focus:outline-none"
        >
          <option value="">All Vendors</option>
          {vendors.map((v) => (
            <option key={v} value={v}>{v}</option>
          ))}
        </select>
        <button type="submit" className="rounded-lg bg-slate-100 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-200">
          Apply
        </button>
        {vendorFilter && (
          <Link href="/procurement/orders" className="text-sm text-indigo-600 hover:underline">Clear</Link>
        )}
      </form>

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="min-w-full text-sm" aria-label="Purchase orders">
          <thead className="bg-slate-100 text-slate-700">
            <tr>
              <th scope="col" className="px-4 py-3 text-left">PO No</th>
              <th scope="col" className="px-4 py-3 text-left">Vendor</th>
              <th scope="col" className="px-4 py-3 text-right">Amount (₹)</th>
              <th scope="col" className="px-4 py-3 text-left">Order Date</th>
              <th scope="col" className="px-4 py-3 text-left">Delivery Date</th>
              <th scope="col" className="px-4 py-3 text-left">GRN Status</th>
              <th scope="col" className="px-4 py-3 text-left">Status</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((order) => (
              <tr key={order.id} className="border-t border-slate-200 hover:bg-slate-50">
                <td className="px-4 py-3">
                  <Link href={`/procurement/orders/${order.id}`} className="font-mono text-indigo-600 hover:underline">
                    {order.poNo}
                  </Link>
                </td>
                <td className="px-4 py-3 text-slate-800">{order.vendor}</td>
                <td className="px-4 py-3 text-right font-medium text-slate-900">
                  ₹{(order.amount / 100).toLocaleString("en-IN")}
                </td>
                <td className="px-4 py-3 text-slate-600">{order.orderDate}</td>
                <td className="px-4 py-3 text-slate-600">{order.deliveryDate ?? "—"}</td>
                <td className="px-4 py-3 text-slate-500 text-xs">{order.grnStatus ?? "—"}</td>
                <td className="px-4 py-3">
                  <span className={`rounded-full px-2 py-1 text-xs font-medium ${statusColors[order.status] ?? "bg-slate-100 text-slate-600"}`}>
                    {statusLabels[order.status] ?? order.status}
                  </span>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-slate-400">No purchase orders found</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </PageShell>
  );
}
