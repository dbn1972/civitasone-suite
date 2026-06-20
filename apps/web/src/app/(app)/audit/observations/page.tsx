import Link from "next/link";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { getAuditObservations } from "../../../_data/loaders";

const typeColors: Record<string, string> = {
  internal: "bg-blue-50 text-blue-700",
  cag: "bg-red-50 text-red-700",
  statutory: "bg-orange-50 text-orange-700",
  concurrent: "bg-purple-50 text-purple-700",
};

const severityColors: Record<string, string> = {
  critical: "bg-red-100 text-red-800",
  major: "bg-orange-100 text-orange-800",
  minor: "bg-yellow-100 text-yellow-800",
  observation: "bg-slate-100 text-slate-600",
};

const statusColors: Record<string, string> = {
  open: "bg-red-50 text-red-700",
  replied: "bg-yellow-50 text-yellow-700",
  partially_closed: "bg-orange-50 text-orange-700",
  closed: "bg-emerald-50 text-emerald-700",
  compliance_pending: "bg-purple-50 text-purple-700",
};

export default async function AuditObservationsPage() {
  const { data: items, source } = await getAuditObservations();

  const today = new Date().toISOString().slice(0, 10);
  const total = items.length;
  const open = items.filter((i) => i.status === "open").length;
  const overdue = items.filter((i) => i.dueDate && i.dueDate < today && i.status !== "closed").length;
  const closed = items.filter((i) => i.status === "closed").length;

  return (
    <main className="min-h-screen bg-slate-50 p-6 md:p-8">
      <section className="mx-auto max-w-7xl space-y-5">
        <nav aria-label="Breadcrumb" className="text-sm text-slate-600">
          <Link href="/audit" className="hover:text-slate-900">Audit</Link>
          <span className="mx-2">/</span>
          <span className="text-slate-900">Observations</span>
        </nav>

        <header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-3xl font-semibold text-slate-900">Audit Observations</h1>
            <p className="mt-1 text-sm text-slate-600">Internal, CAG, statutory, and concurrent audit observations.</p>
          </div>
          {source === "error" ? <DataSourceBadge source={source} /> : null}
        </header>

        <section className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Total</p>
            <p className="mt-1 text-2xl font-bold text-slate-900">{total}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Open</p>
            <p className="mt-1 text-2xl font-bold text-red-600">{open}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Overdue</p>
            <p className="mt-1 text-2xl font-bold text-orange-600">{overdue}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Closed</p>
            <p className="mt-1 text-2xl font-bold text-green-600">{closed}</p>
          </div>
        </section>

        <section className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-slate-100 text-slate-700">
              <tr>
                <th className="px-4 py-3">Obs No</th>
                <th className="px-4 py-3">Title</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Severity</th>
                <th className="px-4 py-3">Department</th>
                <th className="px-4 py-3">Raised Date</th>
                <th className="px-4 py-3">Due Date</th>
                <th className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id} className="border-t border-slate-200 hover:bg-slate-50">
                  <td className="px-4 py-3 font-mono text-xs text-slate-700">
                    <Link href={`/audit/observations/${item.id}`} className="text-indigo-600 hover:underline">
                      {item.observationNo}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-slate-800 max-w-xs truncate">{item.title}</td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${typeColors[item.type] ?? "bg-slate-100 text-slate-600"}`}>
                      {item.type}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${severityColors[item.severity] ?? "bg-slate-100 text-slate-600"}`}>
                      {item.severity}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-600">{item.department ?? "—"}</td>
                  <td className="px-4 py-3 text-slate-600">{item.raisedDate}</td>
                  <td className="px-4 py-3 text-slate-600">{item.dueDate ?? "—"}</td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusColors[item.status] ?? "bg-slate-100 text-slate-600"}`}>
                      {item.status.replace(/_/g, " ")}
                    </span>
                  </td>
                </tr>
              ))}
              {items.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-sm text-slate-400">No observations found.</td>
                </tr>
              )}
            </tbody>
          </table>
        </section>
      </section>
    </main>
  );
}
