import Link from "next/link";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { getProjectsDashboard } from "../../../_data/loaders";

export default async function ProjectsDashboardPage() {
  const { data, source } = await getProjectsDashboard();

  return (
    <main className="min-h-screen bg-slate-50 p-6 md:p-8">
      <section className="mx-auto max-w-7xl space-y-5">
        <nav aria-label="Breadcrumb" className="text-sm text-slate-600">
          <Link href="/projects" className="hover:text-slate-900">Projects</Link>
          <span className="mx-2">/</span>
          <span className="text-slate-900">Dashboard</span>
        </nav>

        <header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-3xl font-semibold text-slate-900">PMU Dashboard</h1>
            <p className="mt-1 text-sm text-slate-600">Real-time project monitoring — schemes, funds and delays.</p>
          </div>
          {source === "error" ? <DataSourceBadge source={source} /> : null}
        </header>

        <section className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Total Projects</p>
            <p className="mt-1 text-2xl font-bold text-slate-900">{data.totalProjects.toLocaleString("en-IN")}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">On Track</p>
            <p className="mt-1 text-2xl font-bold text-emerald-600">{data.onTrackPct.toFixed(1)}%</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Delayed (Red)</p>
            <p className="mt-1 text-2xl font-bold text-red-600">{data.delayed.toLocaleString("en-IN")}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Total Outlay</p>
            <p className="mt-1 text-2xl font-bold text-blue-600">₹{(data.totalOutlay / 100).toLocaleString("en-IN")}</p>
          </div>
        </section>

        <section className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
          {[
            { label: "Projects List", href: "/projects/list" },
            { label: "Milestones", href: "/projects/milestones" },
            { label: "Fund Releases", href: "/projects/fund-releases" },
            { label: "Schemes", href: "/projects/schemes" },
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
