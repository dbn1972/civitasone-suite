import Link from "next/link";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { getEstabFiles } from "../../../_data/loaders";
import type { EstabFileSummary } from "@civitasone/types";

const classificationColors: Record<EstabFileSummary["classification"], string> = {
  top_secret: "bg-red-100 text-red-800",
  secret: "bg-orange-100 text-orange-800",
  confidential: "bg-yellow-100 text-yellow-800",
  restricted: "bg-blue-100 text-blue-800",
  unclassified: "bg-slate-100 text-slate-600",
};

const classificationLabels: Record<EstabFileSummary["classification"], string> = {
  top_secret: "Top Secret",
  secret: "Secret",
  confidential: "Confidential",
  restricted: "Restricted",
  unclassified: "Unclassified",
};

const fileStatusColors: Record<EstabFileSummary["status"], string> = {
  active: "bg-emerald-50 text-emerald-700",
  pending: "bg-amber-50 text-amber-700",
  archived: "bg-slate-100 text-slate-600",
  disposed: "bg-red-50 text-red-700",
};

export default async function EstabFilesListPage() {
  const { data: files, source } = await getEstabFiles();

  return (
    <main className="min-h-screen bg-slate-50 p-6 md:p-8">
      <section className="mx-auto max-w-7xl space-y-5">
        <nav aria-label="Breadcrumb" className="text-sm text-slate-600">
          <Link href="/estab" className="hover:text-slate-900">Establishment</Link>
          <span className="mx-2">/</span>
          <span className="text-slate-900">File Register</span>
        </nav>

        <header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-3xl font-semibold text-slate-900">Digital File Tracking (eOffice)</h1>
            <p className="mt-1 text-sm text-slate-600">Create, route and track files with note sheets &amp; movement trail.</p>
          </div>
          <div className="flex items-center gap-2">
            {source === "error" ? <DataSourceBadge source={source} /> : null}
            <Link
              href="/estab/files/new"
              className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500"
            >
              + Create File
            </Link>
          </div>
        </header>

        <div className="flex flex-wrap gap-3">
          <input
            type="text"
            placeholder="Search file number or subject…"
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
          <select className="rounded-md border border-slate-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
            <option value="">All Classifications</option>
            <option value="top_secret">Top Secret</option>
            <option value="secret">Secret</option>
            <option value="confidential">Confidential</option>
            <option value="restricted">Restricted</option>
            <option value="unclassified">Unclassified</option>
          </select>
          <select className="rounded-md border border-slate-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
            <option value="">All Statuses</option>
            <option value="active">Active</option>
            <option value="pending">Pending</option>
            <option value="archived">Archived</option>
            <option value="disposed">Disposed</option>
          </select>
        </div>

        <section className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-slate-100 text-slate-700">
              <tr>
                <th className="px-4 py-3">File No</th>
                <th className="px-4 py-3">Subject</th>
                <th className="px-4 py-3">Classification</th>
                <th className="px-4 py-3">Department</th>
                <th className="px-4 py-3">Created By</th>
                <th className="px-4 py-3">Created Date</th>
                <th className="px-4 py-3">Current Holder</th>
                <th className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {files.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-slate-400">No files found</td>
                </tr>
              ) : (
                files.map((file) => (
                  <tr key={file.id} className="border-t border-slate-200 hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <Link href={`/estab/files/${file.id}`} className="font-mono text-indigo-600 hover:underline">
                        {file.fileNo}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-slate-800">{file.subject}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${classificationColors[file.classification]}`}>
                        {classificationLabels[file.classification]}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-600">{file.department ?? "—"}</td>
                    <td className="px-4 py-3 text-slate-600">{file.createdBy}</td>
                    <td className="px-4 py-3 text-slate-600">{file.createdDate}</td>
                    <td className="px-4 py-3 text-slate-600">{file.currentHolder ?? "—"}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${fileStatusColors[file.status]}`}>
                        {file.status}
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
