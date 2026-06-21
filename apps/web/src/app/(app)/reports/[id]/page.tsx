import Link from "next/link";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { getReportJobById } from "../../../_data/loaders";

const statusColors: Record<string, string> = {
  queued: "bg-slate-100 text-slate-600",
  running: "bg-amber-50 text-amber-700",
  completed: "bg-emerald-50 text-emerald-700",
  failed: "bg-red-50 text-red-700",
};

const formatColors: Record<string, string> = {
  pdf: "bg-red-50 text-red-700",
  xlsx: "bg-emerald-50 text-emerald-700",
  csv: "bg-blue-50 text-blue-700",
  html: "bg-slate-100 text-slate-600",
};

export default async function ReportDetailPage({ params }: { params: { id: string } }) {
  const { data: job, source } = await getReportJobById(params.id);

  if (!job) {
    return (
      <main className="min-h-screen bg-slate-50 p-6 md:p-8">
        <section className="mx-auto max-w-7xl space-y-5">
          <nav aria-label="Breadcrumb" className="text-sm text-slate-600">
            <Link href="/reports" className="hover:text-slate-900">Reports</Link>
            <span className="mx-2">/</span>
            <Link href="/reports/list" className="hover:text-slate-900">Jobs</Link>
            <span className="mx-2">/</span>
            <span className="text-slate-900">Not Found</span>
          </nav>
          <div className="rounded-xl border border-slate-200 bg-white px-6 py-12 text-center shadow-sm">
            <p className="text-slate-500 font-medium mb-1">Report job not found</p>
            <p className="text-sm text-slate-400">The job may have been deleted or the ID is incorrect.</p>
            {source === "error" ? (
              <div className="mt-4">
                <DataSourceBadge source={source} />
              </div>
            ) : null}
            <Link href="/reports/list" className="mt-4 inline-block text-sm text-blue-600 hover:underline">
              ← Back to jobs
            </Link>
          </div>
        </section>
      </main>
    );
  }

  const displayColumns = job.columns.length > 0
    ? job.columns
    : job.rows.length > 0
      ? Object.keys(job.rows[0])
      : [];

  const visibleRows = job.rows.slice(0, 100);

  return (
    <main className="min-h-screen bg-slate-50 p-6 md:p-8">
      <section className="mx-auto max-w-7xl space-y-5">
        <nav aria-label="Breadcrumb" className="text-sm text-slate-600">
          <Link href="/reports" className="hover:text-slate-900">Reports</Link>
          <span className="mx-2">/</span>
          <Link href="/reports/list" className="hover:text-slate-900">Jobs</Link>
          <span className="mx-2">/</span>
          <span className="text-slate-900">{job.reportName}</span>
        </nav>

        <header className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <h1 className="text-3xl font-semibold text-slate-900">{job.reportName}</h1>
            <div className="mt-2 flex flex-wrap gap-2">
              <span className={`rounded-full px-2 py-1 text-xs font-medium ${statusColors[job.status] ?? "bg-slate-100 text-slate-600"}`}>
                {job.status}
              </span>
              <span className={`rounded-full px-2 py-1 text-xs font-medium uppercase ${formatColors[job.format] ?? "bg-slate-100 text-slate-600"}`}>
                {job.format}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {source === "error" ? <DataSourceBadge source={source} /> : null}
            {job.status === "completed" && job.downloadUrl && (
              <a
                href={job.downloadUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
              >
                Download report
              </a>
            )}
          </div>
        </header>

        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-xs text-slate-500">Module</p>
            <p className="mt-1 text-sm font-medium text-slate-800">{job.module}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-xs text-slate-500">Requested By</p>
            <p className="mt-1 text-sm font-medium text-slate-800">{job.requestedBy}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-xs text-slate-500">Requested At</p>
            <p className="mt-1 text-sm font-medium text-slate-800 whitespace-nowrap">{job.requestedAt}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-xs text-slate-500">Completed At</p>
            <p className="mt-1 text-sm font-medium text-slate-800 whitespace-nowrap">{job.completedAt ?? "—"}</p>
          </div>
        </div>

        {job.parameters && Object.keys(job.parameters).length > 0 && (
          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="mb-3 text-sm font-semibold text-slate-700">Parameters</h2>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-2 md:grid-cols-3">
              {Object.entries(job.parameters).map(([k, v]) => (
                <div key={k}>
                  <dt className="text-xs text-slate-400">{k}</dt>
                  <dd className="text-sm text-slate-800">{v}</dd>
                </div>
              ))}
            </dl>
          </section>
        )}

        {displayColumns.length > 0 ? (
          <section>
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-slate-800">Report Data</h2>
              <p className="text-sm text-slate-500">
                Showing {visibleRows.length.toLocaleString("en-IN")} of{" "}
                {(job.totalCount > 0 ? job.totalCount : job.rows.length).toLocaleString("en-IN")} rows
              </p>
            </div>
            <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
              <table aria-label={`${job.reportName} data`} className="min-w-full text-left text-sm">
                <thead className="bg-slate-100 text-slate-700">
                  <tr>
                    {displayColumns.map((col) => (
                      <th key={col} scope="col" className="px-4 py-3 whitespace-nowrap">{col}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {visibleRows.length === 0 ? (
                    <tr>
                      <td colSpan={displayColumns.length} className="px-4 py-8 text-center text-slate-400">
                        No data rows in this report
                      </td>
                    </tr>
                  ) : (
                    visibleRows.map((row, i) => (
                      <tr key={i} className="border-t border-slate-200 hover:bg-slate-50">
                        {displayColumns.map((col) => (
                          <td key={col} className="px-4 py-3 text-slate-700 whitespace-nowrap">
                            {row[col] ?? "—"}
                          </td>
                        ))}
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>
        ) : (
          <div className="rounded-xl border border-slate-200 bg-white px-6 py-10 text-center shadow-sm">
            <p className="text-slate-400">
              {job.status === "completed"
                ? "No data columns in this report."
                : "Data will be available once the report completes."}
            </p>
          </div>
        )}
      </section>
    </main>
  );
}
