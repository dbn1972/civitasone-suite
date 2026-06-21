import Link from "next/link";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { getProjectsDashboard, getProjects, getSchemes } from "../../../_data/loaders";

const ragColors: Record<string, string> = {
  delayed: "bg-red-50 text-red-700",
  on_hold: "bg-amber-50 text-amber-700",
  active: "bg-emerald-50 text-emerald-700",
  completed: "bg-blue-50 text-blue-700",
  planning: "bg-slate-100 text-slate-600",
  cancelled: "bg-slate-100 text-slate-500",
};

export default async function ProjectsDashboardPage() {
  const [dashResult, projResult, schemeResult] = await Promise.all([
    getProjectsDashboard(),
    getProjects(),
    getSchemes(),
  ]);

  const { data, source } = dashResult;
  const projects = projResult.data;
  const schemes = schemeResult.data;
  const anyError = source === "error" || projResult.source === "error" || schemeResult.source === "error";

  const topDelayed = projects.filter((p) => p.status === "delayed").slice(0, 6);

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
          {anyError ? <DataSourceBadge source="error" /> : null}
        </header>

        <section className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Schemes</p>
            <p className="mt-1 text-2xl font-bold text-indigo-600">{schemes.length.toLocaleString("en-IN")}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Projects</p>
            <p className="mt-1 text-2xl font-bold text-slate-900">{data.totalProjects.toLocaleString("en-IN")}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Outlay (FY)</p>
            <p className="mt-1 text-2xl font-bold text-blue-600">₹{(data.totalOutlay / 100).toLocaleString("en-IN")}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Delayed (Red)</p>
            <p className="mt-1 text-2xl font-bold text-red-600">{data.delayed.toLocaleString("en-IN")}</p>
          </div>
        </section>

        {topDelayed.length > 0 && (
          <section className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
              <p className="text-sm font-semibold text-slate-800">Top Delayed Projects</p>
              <Link href="/projects/list" className="text-xs text-indigo-600 hover:underline">View all →</Link>
            </div>
            <table aria-label="Top delayed projects" className="min-w-full text-sm">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th className="px-4 py-2 text-left text-xs">Project</th>
                  <th className="px-4 py-2 text-left text-xs">Scheme</th>
                  <th className="px-4 py-2 text-left text-xs">Department</th>
                  <th className="px-4 py-2 text-right text-xs">Budget</th>
                  <th className="px-4 py-2 text-left text-xs">RAG</th>
                </tr>
              </thead>
              <tbody>
                {topDelayed.map((p) => (
                  <tr key={p.id} className="border-t border-slate-100 hover:bg-slate-50">
                    <td className="px-4 py-2">
                      <Link href={`/projects/${p.id}`} className="font-medium text-indigo-600 hover:underline">
                        {p.name}
                      </Link>
                    </td>
                    <td className="px-4 py-2 text-slate-600">{p.scheme ?? "—"}</td>
                    <td className="px-4 py-2 text-slate-600">{p.department ?? "—"}</td>
                    <td className="px-4 py-2 text-right text-slate-600">₹{(p.totalBudget / 100).toLocaleString("en-IN")}</td>
                    <td className="px-4 py-2">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${ragColors[p.status] ?? "bg-slate-100 text-slate-600"}`}>
                        {p.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}

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
