import Link from "next/link";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { getAuditPlan } from "../../../_data/loaders";

const typeColors: Record<string, string> = {
  routine: "bg-blue-50 text-blue-700",
  special: "bg-orange-50 text-orange-700",
  compliance: "bg-purple-50 text-purple-700",
  performance: "bg-green-50 text-green-700",
};

const statusColors: Record<string, string> = {
  planned: "bg-blue-50 text-blue-700",
  in_progress: "bg-yellow-50 text-yellow-700",
  completed: "bg-emerald-50 text-emerald-700",
  deferred: "bg-slate-100 text-slate-600",
};

export default async function AuditPlanPage() {
  const { data: items, source } = await getAuditPlan();

  const total = items.length;
  const planned = items.filter((i) => i.status === "planned").length;
  const inProgress = items.filter((i) => i.status === "in_progress").length;
  const completed = items.filter((i) => i.status === "completed").length;

  return (
    <main className="min-h-screen bg-slate-50 p-6 md:p-8">
      <section className="mx-auto max-w-7xl space-y-5">
        <nav aria-label="Breadcrumb" className="text-sm text-slate-600">
          <Link href="/audit" className="hover:text-slate-900">Audit</Link>
          <span className="mx-2">/</span>
          <span className="text-slate-900">Audit Plan</span>
        </nav>

        <header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-3xl font-semibold text-slate-900">Audit Plan</h1>
            <p className="mt-1 text-sm text-slate-600">Scheduled audit engagements by unit, department, and type.</p>
          </div>
          {source === "error" ? <DataSourceBadge source={source} /> : null}
        </header>

        <section className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Total</p>
            <p className="mt-1 text-2xl font-bold text-slate-900">{total}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Planned</p>
            <p className="mt-1 text-2xl font-bold text-blue-600">{planned}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">In Progress</p>
            <p className="mt-1 text-2xl font-bold text-yellow-600">{inProgress}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Completed</p>
            <p className="mt-1 text-2xl font-bold text-green-600">{completed}</p>
          </div>
        </section>

        <section className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table aria-label="Audit plan" className="min-w-full text-left text-sm">
            <thead className="bg-slate-100 text-slate-700">
              <tr>
                <th scope="col" className="px-4 py-3">Audit Unit</th>
                <th scope="col" className="px-4 py-3">Department</th>
                <th scope="col" className="px-4 py-3">Type</th>
                <th scope="col" className="px-4 py-3">Planned From</th>
                <th scope="col" className="px-4 py-3">Planned To</th>
                <th scope="col" className="px-4 py-3">Auditor Team</th>
                <th scope="col" className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id} className="border-t border-slate-200 hover:bg-slate-50">
                  <td className="px-4 py-3 text-slate-800">{item.auditUnit}</td>
                  <td className="px-4 py-3 text-slate-600">{item.department}</td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${typeColors[item.type] ?? "bg-slate-100 text-slate-600"}`}>
                      {item.type}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-600">{item.plannedFrom}</td>
                  <td className="px-4 py-3 text-slate-600">{item.plannedTo}</td>
                  <td className="px-4 py-3 text-slate-600">{item.auditorTeam ?? "—"}</td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusColors[item.status] ?? "bg-slate-100 text-slate-600"}`}>
                      {item.status.replace(/_/g, " ")}
                    </span>
                  </td>
                </tr>
              ))}
              {items.length === 0 && source !== "error" && (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-sm text-slate-500">
                    <span className="block font-medium text-slate-700">No plan items yet</span>
                    <span className="mt-1 block text-slate-400">Scheduled audit engagements will appear here.</span>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </section>
      </section>
    </main>
  );
}
