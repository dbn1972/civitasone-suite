import Link from "next/link";
import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { getEstabFileById } from "../../../../_data/loaders";

const classificationColors: Record<string, string> = {
  top_secret: "bg-red-100 text-red-800",
  secret: "bg-orange-100 text-orange-800",
  confidential: "bg-yellow-100 text-yellow-800",
  restricted: "bg-blue-100 text-blue-800",
  unclassified: "bg-slate-100 text-slate-600",
};

const noteTypeColors: Record<string, string> = {
  note: "bg-blue-50 text-blue-700",
  order: "bg-emerald-50 text-emerald-700",
  remark: "bg-slate-100 text-slate-600",
};

const fileStatusColors: Record<string, string> = {
  active: "bg-emerald-50 text-emerald-700",
  pending: "bg-amber-50 text-amber-700",
  archived: "bg-slate-100 text-slate-600",
  disposed: "bg-red-50 text-red-700",
};

export default async function EstabFileDetailPage({ params }: { params: { id: string } }) {
  const { data: file, source } = await getEstabFileById(params.id);

  if (!file) {
    return (
      <main className="min-h-screen bg-slate-50 p-6 md:p-8">
        <section className="mx-auto max-w-5xl space-y-5">
          <nav aria-label="Breadcrumb" className="text-sm text-slate-600">
            <Link href="/estab" className="hover:text-slate-900">Establishment</Link>
            <span className="mx-2">/</span>
            <Link href="/estab/list" className="hover:text-slate-900">Files</Link>
            <span className="mx-2">/</span>
            <span className="text-slate-900">Not Found</span>
          </nav>
          <p className="text-slate-500">File not found.</p>
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-50 p-6 md:p-8">
      <section className="mx-auto max-w-5xl space-y-5">
        <nav aria-label="Breadcrumb" className="text-sm text-slate-600">
          <Link href="/estab" className="hover:text-slate-900">Establishment</Link>
          <span className="mx-2">/</span>
          <Link href="/estab/list" className="hover:text-slate-900">Files</Link>
          <span className="mx-2">/</span>
          <span className="text-slate-900">{file.fileNo}</span>
        </nav>

        <header className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-lg font-bold text-slate-700">{file.fileNo}</span>
              <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${classificationColors[file.classification] ?? "bg-slate-100 text-slate-600"}`}>
                {file.classification.replace(/_/g, " ")}
              </span>
              <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${fileStatusColors[file.status] ?? "bg-slate-100 text-slate-600"}`}>
                {file.status}
              </span>
            </div>
            <h1 className="mt-1 text-2xl font-semibold text-slate-900">{file.subject}</h1>
            <div className="mt-1 flex flex-wrap gap-4 text-sm text-slate-600">
              {file.department && <span>Dept: {file.department}</span>}
              {file.currentHolder && <span>With: {file.currentHolder}</span>}
            </div>
          </div>
          {source === "error" ? <DataSourceBadge source={source} /> : null}
        </header>

        {file.noteSheets.length > 0 && (
          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="mb-4 text-base font-semibold text-slate-900">Note Sheets</h2>
            <div className="space-y-4">
              {file.noteSheets.map((ns) => (
                <div key={ns.id} className="flex gap-4 border-b border-slate-100 pb-4 last:border-0 last:pb-0">
                  <div className="mt-1.5 h-2.5 w-2.5 flex-shrink-0 rounded-full bg-indigo-400" />
                  <div className="flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${noteTypeColors[ns.type] ?? "bg-slate-100 text-slate-600"}`}>
                        {ns.type}
                      </span>
                      <span className="text-sm font-medium text-slate-800">{ns.author}</span>
                      <span className="text-xs text-slate-400">{ns.timestamp}</span>
                    </div>
                    <p className="mt-1 text-sm text-slate-700">{ns.content}</p>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {file.dispatchHistory.length > 0 && (
          <section className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-100 px-4 py-3 text-sm font-semibold text-slate-800">Dispatch History</div>
            <table className="min-w-full text-left text-sm">
              <thead className="bg-slate-100 text-slate-700">
                <tr>
                  <th className="px-4 py-3">Dispatched To</th>
                  <th className="px-4 py-3">Dispatched By</th>
                  <th className="px-4 py-3">Timestamp</th>
                  <th className="px-4 py-3">Remarks</th>
                </tr>
              </thead>
              <tbody>
                {file.dispatchHistory.map((d) => (
                  <tr key={d.id} className="border-t border-slate-200 hover:bg-slate-50">
                    <td className="px-4 py-3 text-slate-800">{d.dispatchedTo}</td>
                    <td className="px-4 py-3 text-slate-600">{d.dispatchedBy}</td>
                    <td className="px-4 py-3 text-slate-600">{d.timestamp}</td>
                    <td className="px-4 py-3 text-slate-600">{d.remarks ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}

        {file.attachments.length > 0 && (
          <section className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-100 px-4 py-3 text-sm font-semibold text-slate-800">Attachments</div>
            <table className="min-w-full text-left text-sm">
              <thead className="bg-slate-100 text-slate-700">
                <tr>
                  <th className="px-4 py-3">File Name</th>
                  <th className="px-4 py-3">Type</th>
                  <th className="px-4 py-3 text-right">Size (KB)</th>
                  <th className="px-4 py-3">Uploaded At</th>
                </tr>
              </thead>
              <tbody>
                {file.attachments.map((a) => (
                  <tr key={a.id} className="border-t border-slate-200 hover:bg-slate-50">
                    <td className="px-4 py-3 text-indigo-600">{a.fileName}</td>
                    <td className="px-4 py-3 uppercase text-slate-600">{a.fileType}</td>
                    <td className="px-4 py-3 text-right text-slate-600">{(a.size / 1024).toFixed(1)}</td>
                    <td className="px-4 py-3 text-slate-600">{a.uploadedAt}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}
      </section>
    </main>
  );
}
