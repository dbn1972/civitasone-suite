import Link from "next/link";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { getAuditExports } from "../../../_data/loaders";

const statusColors: Record<string, string> = {
  queued: "bg-slate-100 text-slate-600",
  processing: "bg-yellow-50 text-yellow-700",
  completed: "bg-emerald-50 text-emerald-700",
  failed: "bg-red-50 text-red-700",
};

const formatColors: Record<string, string> = {
  pdf: "bg-red-50 text-red-700",
  xlsx: "bg-green-50 text-green-700",
  csv: "bg-blue-50 text-blue-700",
};

export default async function AuditExportsPage() {
  const { data: items, source } = await getAuditExports();

  return (
    <main className="min-h-screen bg-slate-50 p-6 md:p-8">
      <section className="mx-auto max-w-7xl space-y-5">
        <nav aria-label="Breadcrumb" className="text-sm text-slate-600">
          <Link href="/audit" className="hover:text-slate-900">Audit</Link>
          <span className="mx-2">/</span>
          <span className="text-slate-900">Export Jobs</span>
        </nav>

        <header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-3xl font-semibold text-slate-900">Export Jobs</h1>
            <p className="mt-1 text-sm text-slate-600">Scheduled audit data export jobs with download links.</p>
          </div>
          {source === "error" ? <DataSourceBadge source={source} /> : null}
        </header>

        <section className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-slate-100 text-slate-700">
              <tr>
                <th className="px-4 py-3">Job Type</th>
                <th className="px-4 py-3">Requested By</th>
                <th className="px-4 py-3">Requested At</th>
                <th className="px-4 py-3">Completed At</th>
                <th className="px-4 py-3">Format</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Download</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id} className="border-t border-slate-200 hover:bg-slate-50">
                  <td className="px-4 py-3 text-slate-800">{item.jobType}</td>
                  <td className="px-4 py-3 text-slate-600">{item.requestedBy}</td>
                  <td className="px-4 py-3 text-slate-600">{item.requestedAt}</td>
                  <td className="px-4 py-3 text-slate-600">{item.completedAt ?? "—"}</td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium uppercase ${formatColors[item.format] ?? "bg-slate-100 text-slate-600"}`}>
                      {item.format}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusColors[item.status] ?? "bg-slate-100 text-slate-600"}`}>
                      {item.status}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {item.status === "completed" && item.downloadUrl ? (
                      <a href={item.downloadUrl} className="text-indigo-600 hover:underline text-xs" download>
                        Download
                      </a>
                    ) : (
                      <span className="text-slate-400 text-xs">—</span>
                    )}
                  </td>
                </tr>
              ))}
              {items.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-sm text-slate-400">No export jobs found.</td>
                </tr>
              )}
            </tbody>
          </table>
        </section>
      </section>
    </main>
  );
}
