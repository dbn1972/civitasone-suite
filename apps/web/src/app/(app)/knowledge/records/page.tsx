import Link from "next/link";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { getKnowledgeRecords } from "../../../_data/loaders";

const typeColors: Record<string, string> = {
  file: "bg-blue-50 text-blue-700",
  correspondence: "bg-emerald-50 text-emerald-700",
  register: "bg-amber-50 text-amber-700",
  other: "bg-slate-100 text-slate-600",
};

const statusColors: Record<string, string> = {
  active: "bg-emerald-50 text-emerald-700",
  inactive: "bg-slate-100 text-slate-500",
  disposed: "bg-red-50 text-red-700",
  transferred: "bg-blue-50 text-blue-700",
};

export default async function KnowledgeRecordsPage() {
  const { data: records, source } = await getKnowledgeRecords();

  const now = new Date();
  const thirtyDaysFromNow = new Date();
  thirtyDaysFromNow.setDate(now.getDate() + 30);

  const total = records.length;
  const active = records.filter((r) => r.status === "active").length;
  const dueForDisposal = records.filter((r) => {
    if (!r.disposalDueDate) return false;
    const dueDate = new Date(r.disposalDueDate);
    return dueDate <= thirtyDaysFromNow && r.status === "active";
  }).length;
  const disposed = records.filter((r) => r.status === "disposed").length;

  return (
    <main className="min-h-screen bg-slate-50 p-6 md:p-8">
      <section className="mx-auto max-w-7xl space-y-5">
        <nav aria-label="Breadcrumb" className="text-sm text-slate-600">
          <Link href="/knowledge" className="hover:text-slate-900">Knowledge</Link>
          <span className="mx-2">/</span>
          <span className="text-slate-900">Records Management</span>
        </nav>

        <header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-3xl font-semibold text-slate-900">Records Management</h1>
            <p className="mt-1 text-sm text-slate-600">Retention schedules, disposal tracking, and record lifecycle.</p>
          </div>
          {source === "error" ? <DataSourceBadge source={source} /> : null}
        </header>

        <section className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Total Records</p>
            <p className="mt-1 text-2xl font-bold text-slate-900">{total}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Active</p>
            <p className="mt-1 text-2xl font-bold text-emerald-600">{active}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Due for Disposal</p>
            <p className="mt-1 text-2xl font-bold text-amber-600">{dueForDisposal}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Disposed</p>
            <p className="mt-1 text-2xl font-bold text-slate-500">{disposed}</p>
          </div>
        </section>

        <section className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table aria-label="Records retention schedules" className="min-w-full text-left text-sm">
            <thead className="bg-slate-100 text-slate-700">
              <tr>
                <th scope="col" className="px-4 py-3">Record No</th>
                <th scope="col" className="px-4 py-3">Title</th>
                <th scope="col" className="px-4 py-3">Type</th>
                <th scope="col" className="px-4 py-3">Department</th>
                <th scope="col" className="px-4 py-3">Created Date</th>
                <th scope="col" className="px-4 py-3">Retention Period</th>
                <th scope="col" className="px-4 py-3">Disposal Due</th>
                <th scope="col" className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {records.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-slate-400">
                    No records found
                  </td>
                </tr>
              ) : (
                records.map((rec) => {
                  const isDueSoon =
                    rec.disposalDueDate
                      ? new Date(rec.disposalDueDate) <= thirtyDaysFromNow && rec.status === "active"
                      : false;
                  return (
                    <tr key={rec.id} className="border-t border-slate-200 hover:bg-slate-50">
                      <td className="px-4 py-3 font-mono text-xs text-slate-700">{rec.recordNo}</td>
                      <td className="px-4 py-3 font-medium text-slate-900 max-w-xs truncate" title={rec.title}>
                        {rec.title}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`rounded-full px-2 py-1 text-xs font-medium ${typeColors[rec.type] ?? "bg-slate-100 text-slate-600"}`}>
                          {rec.type}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-600">{rec.department ?? "—"}</td>
                      <td className="px-4 py-3 text-slate-600 whitespace-nowrap">{rec.createdDate}</td>
                      <td className="px-4 py-3 text-slate-600">{rec.retentionPeriod ?? "—"}</td>
                      <td className={`px-4 py-3 whitespace-nowrap ${isDueSoon ? "text-amber-600 font-medium" : "text-slate-600"}`}>
                        {rec.disposalDueDate ?? "—"}
                        {isDueSoon && <span className="ml-1 text-xs">(soon)</span>}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`rounded-full px-2 py-1 text-xs font-medium ${statusColors[rec.status] ?? "bg-slate-100 text-slate-600"}`}>
                          {rec.status}
                        </span>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </section>
      </section>
    </main>
  );
}
