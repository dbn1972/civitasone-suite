import Link from "next/link";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { getProjectById } from "../../../_data/loaders";
import type { ProjectDetail } from "@civitasone/types";

const statusColors: Record<string, string> = {
  planning: "bg-slate-100 text-slate-600",
  active: "bg-emerald-50 text-emerald-700",
  on_hold: "bg-amber-50 text-amber-700",
  completed: "bg-blue-50 text-blue-700",
  cancelled: "bg-red-50 text-red-700",
  delayed: "bg-orange-50 text-orange-700",
};

const milestoneColors: Record<string, string> = {
  pending: "bg-amber-50 text-amber-700",
  completed: "bg-emerald-50 text-emerald-700",
  delayed: "bg-red-50 text-red-700",
};

export default async function ProjectDetailPage({ params }: { params: { id: string } }) {
  const { data: project, source } = await getProjectById(params.id);

  if (!project) {
    return (
      <main className="min-h-screen bg-slate-50 p-6 md:p-8">
        <section className="mx-auto max-w-7xl space-y-5">
          <nav aria-label="Breadcrumb" className="text-sm text-slate-600">
            <Link href="/projects" className="hover:text-slate-900">Projects</Link>
            <span className="mx-2">/</span>
            <Link href="/projects/list" className="hover:text-slate-900">Projects List</Link>
            <span className="mx-2">/</span>
            <span className="text-slate-900">Not Found</span>
          </nav>
          <p className="text-slate-500">Project not found.</p>
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-50 p-6 md:p-8">
      <section className="mx-auto max-w-7xl space-y-5">
        <nav aria-label="Breadcrumb" className="text-sm text-slate-600">
          <Link href="/projects" className="hover:text-slate-900">Projects</Link>
          <span className="mx-2">/</span>
          <Link href="/projects/list" className="hover:text-slate-900">Projects List</Link>
          <span className="mx-2">/</span>
          <span className="text-slate-900">{project.projectCode}</span>
        </nav>

        <header className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-3xl font-semibold text-slate-900">{project.name}</h1>
              <span className={`rounded-full px-2 py-1 text-xs font-medium ${statusColors[project.status] ?? "bg-slate-100 text-slate-600"}`}>
                {project.status}
              </span>
            </div>
            <p className="mt-1 text-sm text-slate-600 font-mono">{project.projectCode}</p>
            {project.description ? <p className="mt-2 text-sm text-slate-600">{project.description}</p> : null}
          </div>
          {source === "error" ? <DataSourceBadge source={source} /> : null}
        </header>

        <section className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Scheme</p>
            <p className="mt-1 text-sm font-medium text-slate-900">{project.scheme ?? "—"}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Total Budget</p>
            <p className="mt-1 text-lg font-bold text-blue-600">₹{(project.totalBudget / 100).toLocaleString("en-IN")}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Expenditure</p>
            <p className="mt-1 text-lg font-bold text-slate-900">₹{(project.expenditure / 100).toLocaleString("en-IN")}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Completion</p>
            <p className="mt-1 text-lg font-bold text-emerald-600">{project.completionPct.toFixed(1)}%</p>
          </div>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-6 py-4">
            <h2 className="text-base font-semibold text-slate-900">Milestones</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-slate-100 text-slate-700">
                <tr>
                  <th className="px-4 py-3">Title</th>
                  <th className="px-4 py-3">Due Date</th>
                  <th className="px-4 py-3">Completed Date</th>
                  <th className="px-4 py-3">Status</th>
                </tr>
              </thead>
              <tbody>
                {project.milestones.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-4 py-6 text-center text-slate-400">No milestones</td>
                  </tr>
                ) : (
                  project.milestones.map((m: ProjectDetail["milestones"][number]) => (
                    <tr key={m.id} className="border-t border-slate-200 hover:bg-slate-50">
                      <td className="px-4 py-3 text-slate-800">{m.title}</td>
                      <td className="px-4 py-3 text-slate-600">{m.dueDate}</td>
                      <td className="px-4 py-3 text-slate-600">{m.completedDate ?? "—"}</td>
                      <td className="px-4 py-3">
                        <span className={`rounded-full px-2 py-1 text-xs font-medium ${milestoneColors[m.status] ?? "bg-slate-100 text-slate-600"}`}>
                          {m.status}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-6 py-4">
            <h2 className="text-base font-semibold text-slate-900">Fund Releases</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-slate-100 text-slate-700">
                <tr>
                  <th className="px-4 py-3">Release Date</th>
                  <th className="px-4 py-3 text-right">Amount (₹)</th>
                  <th className="px-4 py-3">Remarks</th>
                </tr>
              </thead>
              <tbody>
                {project.fundReleases.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="px-4 py-6 text-center text-slate-400">No fund releases</td>
                  </tr>
                ) : (
                  project.fundReleases.map((r: ProjectDetail["fundReleases"][number]) => (
                    <tr key={r.id} className="border-t border-slate-200 hover:bg-slate-50">
                      <td className="px-4 py-3 text-slate-600">{r.releaseDate}</td>
                      <td className="px-4 py-3 text-right text-slate-800">₹{(r.amount / 100).toLocaleString("en-IN")}</td>
                      <td className="px-4 py-3 text-slate-600">{r.remarks ?? "—"}</td>
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
