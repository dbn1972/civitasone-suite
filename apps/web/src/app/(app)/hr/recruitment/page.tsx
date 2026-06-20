import Link from "next/link";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { getJobOpenings } from "../../../_data/loaders";

const statusColors: Record<string, string> = {
  open: "bg-emerald-50 text-emerald-700",
  closed: "bg-slate-100 text-slate-600",
  on_hold: "bg-yellow-50 text-yellow-700",
};

export default async function Page() {
  const { data: openings, source } = await getJobOpenings();

  const total = openings.length;
  const open = openings.filter((o) => o.status === "open").length;
  const totalApplications = openings.reduce((sum, o) => sum + o.applicationsReceived, 0);
  const closed = openings.filter((o) => o.status === "closed").length;

  return (
    <main className="min-h-screen bg-slate-50 p-6 md:p-8">
      <section className="mx-auto max-w-7xl space-y-5">
        <nav aria-label="Breadcrumb" className="text-sm text-slate-600">
          <Link href="/hr" className="hover:text-slate-900">HR</Link>
          <span className="mx-2">/</span>
          <span className="text-slate-900">Recruitment</span>
        </nav>

        <header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-3xl font-semibold text-slate-900">Recruitment</h1>
            <p className="mt-1 text-sm text-slate-600">Active job openings and application pipeline.</p>
          </div>
          {source === "error" ? <DataSourceBadge source={source} /> : null}
        </header>

        <section className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Total Openings</p>
            <p className="mt-1 text-2xl font-bold text-slate-900">{total}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Open Positions</p>
            <p className="mt-1 text-2xl font-bold text-emerald-600">{open}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Applications Received</p>
            <p className="mt-1 text-2xl font-bold text-blue-600">{totalApplications.toLocaleString("en-IN")}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Closed</p>
            <p className="mt-1 text-2xl font-bold text-slate-600">{closed}</p>
          </div>
        </section>

        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-100 text-slate-700">
              <tr>
                <th className="px-4 py-3 text-left">Job Title</th>
                <th className="px-4 py-3 text-left">Department</th>
                <th className="px-4 py-3 text-right">Vacancies</th>
                <th className="px-4 py-3 text-right">Applications</th>
                <th className="px-4 py-3 text-left">Deadline</th>
                <th className="px-4 py-3 text-left">Posted Date</th>
                <th className="px-4 py-3 text-left">Status</th>
              </tr>
            </thead>
            <tbody>
              {openings.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-slate-400">
                    No job openings found
                  </td>
                </tr>
              ) : (
                openings.map((opening) => (
                  <tr key={opening.id} className="border-t border-slate-200 hover:bg-slate-50">
                    <td className="px-4 py-3 font-medium text-slate-900">{opening.jobTitle}</td>
                    <td className="px-4 py-3 text-slate-600">{opening.department}</td>
                    <td className="px-4 py-3 text-right text-slate-600">{opening.vacancies}</td>
                    <td className="px-4 py-3 text-right text-slate-600">{opening.applicationsReceived}</td>
                    <td className="px-4 py-3 text-slate-600">{opening.applicationDeadline ?? "—"}</td>
                    <td className="px-4 py-3 text-slate-600">{opening.postedDate}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`rounded-full px-2 py-1 text-xs font-medium ${statusColors[opening.status] ?? "bg-slate-100 text-slate-600"}`}
                      >
                        {opening.status.replace("_", " ")}
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
