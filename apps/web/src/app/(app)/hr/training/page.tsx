import Link from "next/link";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { getTrainingPrograms } from "../../../_data/loaders";

const statusColors: Record<string, string> = {
  upcoming: "bg-blue-50 text-blue-700",
  ongoing: "bg-emerald-50 text-emerald-700",
  completed: "bg-slate-100 text-slate-600",
  cancelled: "bg-red-50 text-red-700",
};

export default async function Page() {
  const { data: programs, source } = await getTrainingPrograms();

  const total = programs.length;
  const upcoming = programs.filter((p) => p.status === "upcoming").length;
  const ongoing = programs.filter((p) => p.status === "ongoing").length;
  const totalEnrolled = programs.reduce((sum, p) => sum + p.enrolledCount, 0);

  return (
    <main className="min-h-screen bg-slate-50 p-6 md:p-8">
      <section className="mx-auto max-w-7xl space-y-5">
        <nav aria-label="Breadcrumb" className="text-sm text-slate-600">
          <Link href="/hr" className="hover:text-slate-900">HR</Link>
          <span className="mx-2">/</span>
          <span className="text-slate-900">Training Programs</span>
        </nav>

        <header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-3xl font-semibold text-slate-900">Training Programs</h1>
            <p className="mt-1 text-sm text-slate-600">Capacity building and skill development initiatives.</p>
          </div>
          {source === "error" ? <DataSourceBadge source={source} /> : null}
        </header>

        <section className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Total Programs</p>
            <p className="mt-1 text-2xl font-bold text-slate-900">{total}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Upcoming</p>
            <p className="mt-1 text-2xl font-bold text-blue-600">{upcoming}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Ongoing</p>
            <p className="mt-1 text-2xl font-bold text-emerald-600">{ongoing}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Total Enrolled</p>
            <p className="mt-1 text-2xl font-bold text-slate-900">{totalEnrolled.toLocaleString("en-IN")}</p>
          </div>
        </section>

        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table aria-label="Training programmes" className="min-w-full text-sm">
            <thead className="bg-slate-100 text-slate-700">
              <tr>
                <th className="px-4 py-3 text-left">Title</th>
                <th className="px-4 py-3 text-left">Category</th>
                <th className="px-4 py-3 text-left">Trainer</th>
                <th className="px-4 py-3 text-left">Start Date</th>
                <th className="px-4 py-3 text-left">End Date</th>
                <th className="px-4 py-3 text-left">Venue</th>
                <th className="px-4 py-3 text-right">Enrolled / Capacity</th>
                <th className="px-4 py-3 text-left">Status</th>
              </tr>
            </thead>
            <tbody>
              {programs.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-slate-400">
                    No training programs found
                  </td>
                </tr>
              ) : (
                programs.map((prog) => (
                  <tr key={prog.id} className="border-t border-slate-200 hover:bg-slate-50">
                    <td className="px-4 py-3 font-medium text-slate-900">{prog.title}</td>
                    <td className="px-4 py-3 text-slate-600">{prog.category}</td>
                    <td className="px-4 py-3 text-slate-600">{prog.trainerName ?? "—"}</td>
                    <td className="px-4 py-3 text-slate-600">{prog.startDate}</td>
                    <td className="px-4 py-3 text-slate-600">{prog.endDate}</td>
                    <td className="px-4 py-3 text-slate-600">{prog.venue ?? "—"}</td>
                    <td className="px-4 py-3 text-right text-slate-600">
                      {prog.enrolledCount}
                      {prog.maxCapacity != null ? ` / ${prog.maxCapacity}` : ""}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`rounded-full px-2 py-1 text-xs font-medium ${statusColors[prog.status] ?? "bg-slate-100 text-slate-600"}`}
                      >
                        {prog.status}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
