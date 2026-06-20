import Link from "next/link";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { getStockDashboard } from "../../../_data/loaders";

export default async function StockDashboardPage() {
  const { data, source } = await getStockDashboard();

  return (
    <main className="min-h-screen bg-slate-50 p-6 md:p-8">
      <section className="mx-auto max-w-7xl space-y-5">
        <nav aria-label="Breadcrumb" className="text-sm text-slate-600">
          <Link href="/stock" className="hover:text-slate-900">Stock</Link>
          <span className="mx-2">/</span>
          <span className="text-slate-900">Dashboard</span>
        </nav>

        <header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-3xl font-semibold text-slate-900">Stock &amp; Inventory</h1>
            <p className="mt-1 text-sm text-slate-600">SKU tracking, GRN management and inventory valuation.</p>
          </div>
          {source === "error" ? <DataSourceBadge source={source} /> : null}
        </header>

        {data.lowStockAlerts > 0 ? (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            <span className="font-semibold">{data.lowStockAlerts} items</span> are below minimum stock level.{" "}
            <Link href="/stock/list" className="underline hover:no-underline">View low stock items →</Link>
          </div>
        ) : null}

        <section className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Total SKUs</p>
            <p className="mt-1 text-2xl font-bold text-slate-900">{data.totalSKUs.toLocaleString("en-IN")}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Low Stock Alerts</p>
            <p className="mt-1 text-2xl font-bold text-red-600">{data.lowStockAlerts.toLocaleString("en-IN")}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">GRNs This Month</p>
            <p className="mt-1 text-2xl font-bold text-blue-600">{data.grnsThisMonth.toLocaleString("en-IN")}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Inventory Value (₹)</p>
            <p className="mt-1 text-2xl font-bold text-emerald-600">₹{(data.inventoryValue / 100).toLocaleString("en-IN")}</p>
          </div>
        </section>

        <section className="grid grid-cols-2 gap-3 md:grid-cols-3">
          {[
            { label: "Stock List", href: "/stock/list" },
            { label: "Stock Ledger", href: "/stock/ledger" },
          ].map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md text-sm font-medium text-slate-800"
            >
              {link.label}
            </Link>
          ))}
        </section>
      </section>
    </main>
  );
}
