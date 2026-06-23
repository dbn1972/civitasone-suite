import Link from "next/link";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { getStockItems } from "../../../_data/loaders";

export default async function InventoryListPage() {
  const { data: items, source } = await getStockItems();

  const lowStockCount = items.filter((i) => i.isLowStock).length;

  return (
    <main className="min-h-screen bg-slate-50 p-6 md:p-8">
      <section className="mx-auto max-w-7xl space-y-5">
        <nav aria-label="Breadcrumb" className="text-sm text-slate-600">
          <Link href="/inventory" className="hover:text-slate-900">Inventory</Link>
          <span className="mx-2">/</span>
          <span className="text-slate-900">Stock Items</span>
        </nav>

        <header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-3xl font-semibold text-slate-900">Inventory Items</h1>
            <p className="mt-1 text-sm text-slate-600">Stock SKUs shared with the inventory module.</p>
          </div>
          {source === "error" ? <DataSourceBadge source={source} /> : null}
        </header>

        <section className="grid grid-cols-2 gap-4 md:grid-cols-3">
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Total SKUs</p>
            <p className="mt-1 text-2xl font-bold text-slate-900">{items.length.toLocaleString("en-IN")}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Low Stock</p>
            <p className="mt-1 text-2xl font-bold text-red-600">{lowStockCount.toLocaleString("en-IN")}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Detailed view</p>
            <Link href="/stock/list" className="mt-2 inline-block text-sm font-semibold text-indigo-600 hover:text-indigo-500">
              Open stock register →
            </Link>
          </div>
        </section>
      </section>
    </main>
  );
}
