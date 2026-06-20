import Link from "next/link";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { getGrantsDashboard } from "../../../_data/loaders";

export default async function GrantsDashboardPage() {
  const { data, source } = await getGrantsDashboard();

  return (
    <main className="min-h-screen bg-slate-50 p-6 md:p-8">
      <section className="mx-auto max-w-7xl space-y-5">
        <nav aria-label="Breadcrumb" className="text-sm text-slate-600">
          <Link href="/grants" className="hover:text-slate-900">Grants</Link>
          <span className="mx-2">/</span>
          <span className="text-slate-900">Dashboard</span>
        </nav>

        <header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-3xl font-semibold text-slate-900">Grants &amp; Fund Management</h1>
            <p className="mt-1 text-sm text-slate-600">Grant lifecycle, releases, utilisation and audit — one view.</p>
          </div>
          {source === "error" ? <DataSourceBadge source={source} /> : null}
        </header>

        <section className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Total Grants</p>
            <p className="mt-1 text-2xl font-bold text-slate-900">{data.totalGrants.toLocaleString("en-IN")}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Disbursed Amount</p>
            <p className="mt-1 text-2xl font-bold text-emerald-600">₹{(data.disbursedAmount / 100).toLocaleString("en-IN")}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Pending UCs</p>
            <p className="mt-1 text-2xl font-bold text-amber-600">{data.pendingUCs.toLocaleString("en-IN")}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Total Grantees</p>
            <p className="mt-1 text-2xl font-bold text-blue-600">{data.totalGrantees.toLocaleString("en-IN")}</p>
          </div>
        </section>

        <section className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
          {[
            { label: "Grants List", href: "/grants/list" },
            { label: "Grantees", href: "/grants/grantees" },
            { label: "Releases", href: "/grants/releases" },
            { label: "Installments", href: "/grants/installments" },
            { label: "UC Management", href: "/grants/utilization" },
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
