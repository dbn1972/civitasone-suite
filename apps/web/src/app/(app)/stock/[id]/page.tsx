import Link from "next/link";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { getStockItemById } from "../../../_data/loaders";

const ledgerTypeColors: Record<string, string> = {
  receipt: "bg-emerald-50 text-emerald-700",
  issue: "bg-red-50 text-red-700",
  transfer: "bg-blue-50 text-blue-700",
  adjustment: "bg-amber-50 text-amber-700",
};

export default async function StockItemDetailPage({ params }: { params: { id: string } }) {
  const { data: item, source } = await getStockItemById(params.id);

  if (!item) {
    return (
      <main className="min-h-screen bg-slate-50 p-6 md:p-8">
        <section className="mx-auto max-w-7xl space-y-5">
          <nav aria-label="Breadcrumb" className="text-sm text-slate-600">
            <Link href="/stock" className="hover:text-slate-900">Stock</Link>
            <span className="mx-2">/</span>
            <Link href="/stock/list" className="hover:text-slate-900">Items</Link>
            <span className="mx-2">/</span>
            <span className="text-slate-900">Not Found</span>
          </nav>
          <p className="text-slate-500">Stock item not found.</p>
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-50 p-6 md:p-8">
      <section className="mx-auto max-w-7xl space-y-5">
        <nav aria-label="Breadcrumb" className="text-sm text-slate-600">
          <Link href="/stock" className="hover:text-slate-900">Stock</Link>
          <span className="mx-2">/</span>
          <Link href="/stock/list" className="hover:text-slate-900">Items</Link>
          <span className="mx-2">/</span>
          <span className="text-slate-900">{item.itemCode}</span>
        </nav>

        <header className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-3xl font-semibold text-slate-900">{item.name}</h1>
              {item.isLowStock ? (
                <span className="rounded-full bg-red-100 px-2 py-1 text-xs font-medium text-red-700">Low Stock</span>
              ) : (
                <span className="rounded-full bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-700">OK</span>
              )}
            </div>
            <p className="mt-1 font-mono text-sm text-slate-600">{item.itemCode} · {item.category} · {item.unit}</p>
            {item.description ? <p className="mt-2 text-sm text-slate-600">{item.description}</p> : null}
          </div>
          {source === "error" ? <DataSourceBadge source={source} /> : null}
        </header>

        <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-6 py-4">
            <h2 className="text-base font-semibold text-slate-900">Details</h2>
          </div>
          <dl className="grid grid-cols-2 gap-4 p-6 md:grid-cols-3 lg:grid-cols-4">
            {[
              { label: "Current Stock", value: item.currentStock.toLocaleString("en-IN") },
              { label: "Min Level", value: item.minStockLevel.toLocaleString("en-IN") },
              { label: "Max Level", value: item.maxStockLevel?.toLocaleString("en-IN") ?? "—" },
              { label: "Unit Cost (₹)", value: `₹${(item.unitCost / 100).toLocaleString("en-IN")}` },
              { label: "Total Value (₹)", value: `₹${(item.totalValue / 100).toLocaleString("en-IN")}` },
              { label: "GST Rate", value: item.gstRate != null ? `${item.gstRate}%` : "—" },
              { label: "HSN Code", value: item.hsnCode ?? "—" },
              { label: "Warehouse", value: item.warehouseLocation ?? "—" },
            ].map((field) => (
              <div key={field.label}>
                <dt className="text-xs text-slate-500">{field.label}</dt>
                <dd className="mt-1 text-sm font-medium text-slate-900">{field.value}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-6 py-4">
            <h2 className="text-base font-semibold text-slate-900">Stock Ledger</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-slate-100 text-slate-700">
                <tr>
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3">Type</th>
                  <th className="px-4 py-3 text-right">Quantity</th>
                  <th className="px-4 py-3 text-right">Unit Cost (₹)</th>
                  <th className="px-4 py-3 text-right">Total Value (₹)</th>
                  <th className="px-4 py-3">Reference</th>
                  <th className="px-4 py-3">Party</th>
                  <th className="px-4 py-3 text-right">Balance</th>
                </tr>
              </thead>
              <tbody>
                {item.stockLedger.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-6 text-center text-slate-400">No ledger entries</td>
                  </tr>
                ) : (
                  item.stockLedger.map((entry) => (
                    <tr key={entry.id} className="border-t border-slate-200 hover:bg-slate-50">
                      <td className="px-4 py-3 text-slate-600">{entry.date}</td>
                      <td className="px-4 py-3">
                        <span className={`rounded-full px-2 py-1 text-xs font-medium ${ledgerTypeColors[entry.type] ?? "bg-slate-100 text-slate-600"}`}>
                          {entry.type}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right text-slate-800">{entry.quantity.toLocaleString("en-IN")}</td>
                      <td className="px-4 py-3 text-right text-slate-800">₹{(entry.unitCost / 100).toLocaleString("en-IN")}</td>
                      <td className="px-4 py-3 text-right text-slate-800">₹{(entry.totalValue / 100).toLocaleString("en-IN")}</td>
                      <td className="px-4 py-3 font-mono text-xs text-slate-600">{entry.referenceNo ?? "—"}</td>
                      <td className="px-4 py-3 text-slate-600">{entry.party ?? "—"}</td>
                      <td className="px-4 py-3 text-right font-medium text-slate-900">{entry.balance.toLocaleString("en-IN")}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      </section>
    </main>
  );
}
