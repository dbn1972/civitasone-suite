import Link from "next/link";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { getMilestones } from "../../../_data/loaders";

const statusColors: Record<string, string> = {
  pending: "bg-amber-50 text-amber-700",
  completed: "bg-emerald-50 text-emerald-700",
  delayed: "bg-red-50 text-red-700",
};

export default async function MilestonesPage() {
  const { data: milestones, source } = await getMilestones();

  const pending = milestones.filter((m) => m.status === "pending").length;
  const completed = milestones.filter((m) => m.status === "completed").length;
  const delayed = milestones.filter((m) => m.status === "delayed").length;

  return (
    <main className="min-h-screen bg-slate-50 p-6 md:p-8">
      <section className="mx-auto max-w-7xl space-y-5">
        <nav aria-label="Breadcrumb" className="text-sm text-slate-600">
          <Link href="/projects" className="hover:text-slate-900">Projects</Link>
          <span className="mx-2">/</span>
          <span className="text-slate-900">Milestones</span>
        </nav>

        <header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-3xl font-semibold text-slate-900">Milestones</h1>
            <p className="mt-1 text-sm text-slate-600">Project milestones and completion tracking.</p>
          </div>
          {source === "error" ? <DataSourceBadge source={source} /> : null}
        </header>

        <section className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Total</p>
            <p className="mt-1 text-2xl font-bold text-slate-900">{milestones.length}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Pending</p>
            <p className="mt-1 text-2xl font-bold text-amber-600">{pending}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Completed</p>
            <p className="mt-1 text-2xl font-bold text-emerald-600">{completed}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Delayed</p>
            <p className="mt-1 text-2xl font-bold text-red-600">{delayed}</p>
          </div>
        </section>

        <section className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table aria-label="Project milestones" className="min-w-full text-left text-sm">
            <thead className="bg-slate-100 text-slate-700">
              <tr>
                <th className="px-4 py-3">Project Name</th>
                <th className="px-4 py-3">Milestone Title</th>
                <th className="px-4 py-3">Due Date</th>
                <th className="px-4 py-3">Completed Date</th>
                <th className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {milestones.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-slate-400">No milestones found</td>
                </tr>
              ) : (
                milestones.map((m) => (
                  <tr key={m.id} className="border-t border-slate-200 hover:bg-slate-50">
                    <td className="px-4 py-3 text-slate-700">
                      <Link href={`/projects/${m.projectId}`} className="hover:underline text-indigo-600">{m.projectName}</Link>
                    </td>
                    <td className="px-4 py-3 text-slate-800">{m.title}</td>
                    <td className="px-4 py-3 text-slate-600">{m.dueDate}</td>
                    <td className="px-4 py-3 text-slate-600">{m.completedDate ?? "—"}</td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2 py-1 text-xs font-medium ${statusColors[m.status] ?? "bg-slate-100 text-slate-600"}`}>
                        {m.status}
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
