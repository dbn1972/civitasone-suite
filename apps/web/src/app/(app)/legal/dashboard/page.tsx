import Link from "next/link";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { getLegalDashboard } from "../../../_data/loaders";

export default async function LegalDashboardPage() {
  const { data, source } = await getLegalDashboard();

  return (
    <main className="min-h-screen bg-slate-50 p-6 md:p-8">
      <section className="mx-auto max-w-7xl space-y-5">
        <nav aria-label="Breadcrumb" className="text-sm text-slate-600">
          <Link href="/legal" className="hover:text-slate-900">Legal</Link>
          <span className="mx-2">/</span>
          <span className="text-slate-900">Dashboard</span>
        </nav>

        <header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-3xl font-semibold text-slate-900">Legal Dashboard</h1>
            <p className="mt-1 text-sm text-slate-600">Active cases, upcoming hearings, pending court orders, and legal opinions.</p>
          </div>
          {source === "error" ? <DataSourceBadge source={source} /> : null}
        </header>

        <section className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Active Cases</p>
            <p className="mt-1 text-2xl font-bold text-blue-600">{data.activeCases}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Hearings This Week</p>
            <p className="mt-1 text-2xl font-bold text-orange-600">{data.hearingsThisWeek}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Orders Pending</p>
            <p className="mt-1 text-2xl font-bold text-yellow-600">{data.ordersPending}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Opinions Due</p>
            <p className="mt-1 text-2xl font-bold text-purple-600">{data.opinionsDue}</p>
          </div>
        </section>

        <section className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
          {[
            { label: "Cases List", href: "/legal/list" },
            { label: "Hearings", href: "/legal/hearings" },
            { label: "Court Orders", href: "/legal/court-orders" },
            { label: "Legal Opinions", href: "/legal/opinions" },
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
