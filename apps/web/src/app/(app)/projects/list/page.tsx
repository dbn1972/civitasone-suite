import Link from "next/link";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { getProjects } from "../../../_data/loaders";

const statusColors: Record<string, string> = {
  planning: "bg-slate-100 text-slate-600",
  active: "bg-emerald-50 text-emerald-700",
  on_hold: "bg-amber-50 text-amber-700",
  completed: "bg-blue-50 text-blue-700",
  cancelled: "bg-red-50 text-red-700",
  delayed: "bg-orange-50 text-orange-700",
};

const statusLabel: Record<string, string> = {
  planning: "Planning",
  active: "Active",
  on_hold: "On Hold",
  completed: "Completed",
  cancelled: "Cancelled",
  delayed: "Delayed",
};

export default async function ProjectsListPage() {
  const { data: projects, source } = await getProjects();

  const active = projects.filter((p) => p.status === "active").length;
  const delayed = projects.filter((p) => p.status === "delayed").length;
  const completed = projects.filter((p) => p.status === "completed").length;

  return (
    <main className="min-h-screen bg-slate-50 p-6 md:p-8">
      <section className="mx-auto max-w-7xl space-y-5">
        <nav aria-label="Breadcrumb" className="text-sm text-slate-600">
          <Link href="/projects" className="hover:text-slate-900">Projects</Link>
          <span className="mx-2">/</span>
          <span className="text-slate-900">Projects List</span>
        </nav>

        <header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-3xl font-semibold text-slate-900">Projects</h1>
            <p className="mt-1 text-sm text-slate-600">All projects with budget, expenditure and completion status.</p>
          </div>
          {source === "error" ? <DataSourceBadge source={source} /> : null}
        </header>

        <section className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Total</p>
            <p className="mt-1 text-2xl font-bold text-slate-900">{projects.length}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Active</p>
            <p className="mt-1 text-2xl font-bold text-emerald-600">{active}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Delayed</p>
            <p className="mt-1 text-2xl font-bold text-orange-600">{delayed}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Completed</p>
            <p className="mt-1 text-2xl font-bold text-blue-600">{completed}</p>
          </div>
        </section>

        <section className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table aria-label="Projects list" className="min-w-full text-left text-sm">
            <thead className="bg-slate-100 text-slate-700">
              <tr>
                <th className="px-4 py-3">Project Code</th>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Scheme</th>
                <th className="px-4 py-3">Department</th>
                <th className="px-4 py-3">Start Date</th>
                <th className="px-4 py-3 text-right">Budget (₹)</th>
                <th className="px-4 py-3 text-right">Expenditure (₹)</th>
                <th className="px-4 py-3 text-right">Completion %</th>
                <th className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {projects.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-8 text-center text-slate-400">No projects found</td>
                </tr>
              ) : (
                projects.map((p) => (
                  <tr key={p.id} className="border-t border-slate-200 hover:bg-slate-50">
                    <td className="px-4 py-3 font-mono text-xs text-slate-900">
                      <Link href={`/projects/${p.id}`} className="text-indigo-600 hover:underline">{p.projectCode}</Link>
                    </td>
                    <td className="px-4 py-3 text-slate-800 max-w-xs truncate">{p.name}</td>
                    <td className="px-4 py-3 text-slate-600">{p.scheme ?? "—"}</td>
                    <td className="px-4 py-3 text-slate-600">{p.department ?? "—"}</td>
                    <td className="px-4 py-3 text-slate-600">{p.startDate}</td>
                    <td className="px-4 py-3 text-right text-slate-800">₹{(p.totalBudget / 100).toLocaleString("en-IN")}</td>
                    <td className="px-4 py-3 text-right text-slate-800">₹{(p.expenditure / 100).toLocaleString("en-IN")}</td>
                    <td className="px-4 py-3 text-right text-slate-700">{p.completionPct.toFixed(1)}%</td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2 py-1 text-xs font-medium ${statusColors[p.status] ?? "bg-slate-100 text-slate-600"}`}>
                        {statusLabel[p.status] ?? p.status}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </section>
      </section>
    </main>
  );
}
