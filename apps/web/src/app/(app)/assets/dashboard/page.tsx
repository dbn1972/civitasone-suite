import Link from "next/link";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { getAssetDashboard } from "../../../_data/loaders";

export default async function AssetDashboardPage() {
  const { data, source } = await getAssetDashboard();

  return (
    <main className="min-h-screen bg-slate-50 p-6 md:p-8">
      <section className="mx-auto max-w-7xl space-y-5">
        <nav aria-label="Breadcrumb" className="text-sm text-slate-600">
          <Link href="/assets" className="hover:text-slate-900">Assets</Link>
          <span className="mx-2">/</span>
          <span className="text-slate-900">Dashboard</span>
        </nav>

        <header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-3xl font-semibold text-slate-900">Asset Management</h1>
            <p className="mt-1 text-sm text-slate-600">Fixed &amp; infrastructure assets, maintenance and disposal.</p>
          </div>
          {source === "error" ? <DataSourceBadge source={source} /> : null}
        </header>

        <section className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Total Assets</p>
            <p className="mt-1 text-2xl font-bold text-slate-900">{data.totalAssets.toLocaleString("en-IN")}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Under Maintenance</p>
            <p className="mt-1 text-2xl font-bold text-amber-600">{data.underMaintenance.toLocaleString("en-IN")}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Due for Disposal</p>
            <p className="mt-1 text-2xl font-bold text-red-600">{data.dueForDisposal.toLocaleString("en-IN")}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Net Block (₹)</p>
            <p className="mt-1 text-2xl font-bold text-emerald-600">₹{(data.netBlock / 100).toLocaleString("en-IN")}</p>
          </div>
        </section>

        <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {[
            { label: "Asset List", href: "/assets/list" },
            { label: "Fixed Assets", href: "/assets/fixed-assets" },
            { label: "Infrastructure", href: "/assets/infra" },
            { label: "Maintenance", href: "/assets/maintenance" },
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
