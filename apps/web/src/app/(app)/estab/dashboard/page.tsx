import Link from "next/link";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { getEstabDashboard } from "../../../_data/loaders";

export default async function EstabDashboardPage() {
  const { data, source } = await getEstabDashboard();

  return (
    <main className="min-h-screen bg-slate-50 p-6 md:p-8">
      <section className="mx-auto max-w-7xl space-y-5">
        <nav aria-label="Breadcrumb" className="text-sm text-slate-600">
          <Link href="/estab" className="hover:text-slate-900">Establishment</Link>
          <span className="mx-2">/</span>
          <span className="text-slate-900">Dashboard</span>
        </nav>

        <header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-3xl font-semibold text-slate-900">Establishment &amp; Administration</h1>
            <p className="mt-1 text-sm text-slate-600">Files, meetings, fleet, guest house and compliance.</p>
          </div>
          {source === "error" ? <DataSourceBadge source={source} /> : null}
        </header>

        <section className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Files Pending</p>
            <p className="mt-1 text-2xl font-bold text-amber-600">{data.filesPending.toLocaleString("en-IN")}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Meetings Today</p>
            <p className="mt-1 text-2xl font-bold text-blue-600">{data.meetingsToday.toLocaleString("en-IN")}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Vehicles In Use</p>
            <p className="mt-1 text-2xl font-bold text-emerald-600">{data.vehiclesInUse.toLocaleString("en-IN")}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Compliance Items Due</p>
            <p className="mt-1 text-2xl font-bold text-red-600">{data.complianceItemsDue.toLocaleString("en-IN")}</p>
          </div>
        </section>

        <section className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
          {[
            { label: "Files (eOffice)", href: "/estab/list" },
            { label: "New File", href: "/estab/files/new" },
            { label: "Meetings", href: "/estab/meetings" },
            { label: "Fleet", href: "/estab/vehicles" },
            { label: "Guest House", href: "/estab/guesthouse" },
            { label: "Compliance", href: "/estab/compliance" },
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
