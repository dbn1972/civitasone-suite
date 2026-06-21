import Link from "next/link";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { getStockItems } from "../../../_data/loaders";

export default async function StockListPage() {
  const { data: items, source } = await getStockItems();

  const lowStockCount = items.filter((i) => i.isLowStock).length;
  const totalValue = items.reduce((sum, i) => sum + i.totalValue, 0);
  const categories = new Set(items.map((i) => i.category)).size;

  return (
    <main className="min-h-screen bg-slate-50 p-6 md:p-8">
      <section className="mx-auto max-w-7xl space-y-5">
        <nav aria-label="Breadcrumb" className="text-sm text-slate-600">
          <Link href="/stock" className="hover:text-slate-900">Stock</Link>
          <span className="mx-2">/</span>
          <span className="text-slate-900">Items</span>
        </nav>

        <header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-3xl font-semibold text-slate-900">Stock Items</h1>
            <p className="mt-1 text-sm text-slate-600">All stock-keeping units, levels and valuations.</p>
          </div>
          {source === "error" ? <DataSourceBadge source={source} /> : null}
        </header>

        <section className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Total SKUs</p>
            <p className="mt-1 text-2xl font-bold text-slate-900">{items.length.toLocaleString("en-IN")}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Low Stock Items</p>
            <p className="mt-1 text-2xl font-bold text-red-600">{lowStockCount.toLocaleString("en-IN")}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Total Value (₹)</p>
            <p className="mt-1 text-2xl font-bold text-emerald-600">₹{(totalValue / 100).toLocaleString("en-IN")}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Categories</p>
            <p className="mt-1 text-2xl font-bold text-blue-600">{categories.toLocaleString("en-IN")}</p>
          </div>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table aria-label="Stock items" className="min-w-full text-left text-sm">
              <thead className="bg-slate-100 text-slate-700">
                <tr>
                  <th scope="col" className="px-4 py-3">Item Code</th>
                  <th scope="col" className="px-4 py-3">Name</th>
                  <th scope="col" className="px-4 py-3">Category</th>
                  <th scope="col" className="px-4 py-3">Unit</th>
                  <th scope="col" className="px-4 py-3 text-right">Current Stock</th>
                  <th scope="col" className="px-4 py-3 text-right">Min Level</th>
                  <th scope="col" className="px-4 py-3 text-right">Unit Cost (₹)</th>
                  <th scope="col" className="px-4 py-3 text-right">Total Value (₹)</th>
                  <th scope="col" className="px-4 py-3">Warehouse</th>
                  <th scope="col" className="px-4 py-3">Status</th>
                </tr>
              </thead>
              <tbody>
                {items.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="px-4 py-6 text-center text-slate-400">No stock items found</td>
                  </tr>
                ) : (
                  items.map((item) => (
                    <tr key={item.id} className={`border-t border-slate-200 hover:bg-slate-50 ${item.isLowStock ? "bg-red-50" : ""}`}>
                      <td className="px-4 py-3">
                        <Link href={`/stock/${item.id}`} className="font-mono text-xs text-blue-600 hover:underline">
                          {item.itemCode}
                        </Link>
                      </td>
                      <td className="px-4 py-3 font-medium text-slate-900">{item.name}</td>
                      <td className="px-4 py-3 text-slate-600">{item.category}</td>
                      <td className="px-4 py-3 text-slate-600">{item.unit}</td>
                      <td className="px-4 py-3 text-right text-slate-800">{item.currentStock.toLocaleString("en-IN")}</td>
                      <td className="px-4 py-3 text-right text-slate-600">{item.minStockLevel.toLocaleString("en-IN")}</td>
                      <td className="px-4 py-3 text-right text-slate-800">₹{(item.unitCost / 100).toLocaleString("en-IN")}</td>
                      <td className="px-4 py-3 text-right text-slate-800">₹{(item.totalValue / 100).toLocaleString("en-IN")}</td>
                      <td className="px-4 py-3 text-slate-600">{item.warehouseLocation ?? "—"}</td>
                      <td className="px-4 py-3">
                        {item.isLowStock ? (
                          <span className="rounded-full bg-red-100 px-2 py-1 text-xs font-medium text-red-700">Low Stock</span>
                        ) : (
                          <span className="rounded-full bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-700">OK</span>
                        )}
                      </td>
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
