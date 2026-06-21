import Link from "next/link";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { getReportJobs } from "../../../_data/loaders";

const formatColors: Record<string, string> = {
  pdf: "bg-red-50 text-red-700",
  xlsx: "bg-emerald-50 text-emerald-700",
  csv: "bg-blue-50 text-blue-700",
  html: "bg-slate-100 text-slate-600",
};

const statusColors: Record<string, string> = {
  queued: "bg-slate-100 text-slate-600",
  running: "bg-amber-50 text-amber-700",
  completed: "bg-emerald-50 text-emerald-700",
  failed: "bg-red-50 text-red-700",
};

export default async function ReportsListPage() {
  const { data: jobs, source } = await getReportJobs();

  const total = jobs.length;
  const completed = jobs.filter((j) => j.status === "completed").length;
  const running = jobs.filter((j) => j.status === "running").length;
  const failed = jobs.filter((j) => j.status === "failed").length;

  return (
    <main className="min-h-screen bg-slate-50 p-6 md:p-8">
      <section className="mx-auto max-w-7xl space-y-5">
        <nav aria-label="Breadcrumb" className="text-sm text-slate-600">
          <Link href="/reports" className="hover:text-slate-900">Reports</Link>
          <span className="mx-2">/</span>
          <span className="text-slate-900">Jobs</span>
        </nav>

        <header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-3xl font-semibold text-slate-900">Report Jobs</h1>
            <p className="mt-1 text-sm text-slate-600">All report generation jobs and their status.</p>
          </div>
          {source === "error" ? <DataSourceBadge source={source} /> : null}
        </header>

        <section aria-label="Report job statistics" className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Total</p>
            <p className="mt-1 text-2xl font-bold text-slate-900">{total.toLocaleString("en-IN")}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Completed</p>
            <p className="mt-1 text-2xl font-bold text-emerald-600">{completed.toLocaleString("en-IN")}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Running</p>
            <p className="mt-1 text-2xl font-bold text-amber-600">{running.toLocaleString("en-IN")}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Failed</p>
            <p className="mt-1 text-2xl font-bold text-red-600">{failed.toLocaleString("en-IN")}</p>
          </div>
        </section>

        <section className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table aria-label="Report jobs" className="min-w-full text-left text-sm">
            <thead className="bg-slate-100 text-slate-700">
              <tr>
                <th scope="col" className="px-4 py-3">Report Name</th>
                <th scope="col" className="px-4 py-3">Module</th>
                <th scope="col" className="px-4 py-3">Requested By</th>
                <th scope="col" className="px-4 py-3">Requested At</th>
                <th scope="col" className="px-4 py-3">Completed At</th>
                <th scope="col" className="px-4 py-3">Format</th>
                <th scope="col" className="px-4 py-3 text-right">Rows</th>
                <th scope="col" className="px-4 py-3">Status</th>
                <th scope="col" className="px-4 py-3">Download</th>
              </tr>
            </thead>
            <tbody>
              {jobs.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-10 text-center text-slate-400">
                    No report jobs found. Jobs will appear here once generated.
                  </td>
                </tr>
              ) : (
                jobs.map((j) => (
                  <tr key={j.id} className="border-t border-slate-200 hover:bg-slate-50">
                    <td className="px-4 py-3 font-medium text-slate-900">
                      <Link href={`/reports/${j.id}`} className="hover:underline text-blue-700">
                        {j.reportName}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-slate-600">{j.module}</td>
                    <td className="px-4 py-3 text-slate-600">{j.requestedBy}</td>
                    <td className="px-4 py-3 text-slate-600 whitespace-nowrap">{j.requestedAt}</td>
                    <td className="px-4 py-3 text-slate-600 whitespace-nowrap">{j.completedAt ?? "—"}</td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2 py-1 text-xs font-medium uppercase ${formatColors[j.format] ?? "bg-slate-100 text-slate-600"}`}>
                        {j.format}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right text-slate-600">
                      {j.rowCount !== undefined ? j.rowCount.toLocaleString("en-IN") : "—"}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2 py-1 text-xs font-medium ${statusColors[j.status] ?? "bg-slate-100 text-slate-600"}`}>
                        {j.status}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {j.status === "completed" && j.downloadUrl ? (
                        <a
                          href={j.downloadUrl}
                          className="text-xs text-blue-600 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 rounded"
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          Download
                        </a>
                      ) : (
                        <span className="text-xs text-slate-400">—</span>
                      )}
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
