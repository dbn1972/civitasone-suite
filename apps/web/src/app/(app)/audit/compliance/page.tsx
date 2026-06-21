import Link from "next/link";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { getAuditCompliance } from "../../../_data/loaders";

const statusColors: Record<string, string> = {
  complied: "bg-emerald-50 text-emerald-700",
  pending: "bg-yellow-50 text-yellow-700",
  overdue: "bg-red-50 text-red-700",
  na: "bg-slate-100 text-slate-600",
};

export default async function AuditCompliancePage() {
  const { data: items, source } = await getAuditCompliance();

  const total = items.length;
  const complied = items.filter((i) => i.status === "complied").length;
  const pending = items.filter((i) => i.status === "pending").length;
  const overdue = items.filter((i) => i.status === "overdue").length;

  return (
    <main className="min-h-screen bg-slate-50 p-6 md:p-8">
      <section className="mx-auto max-w-7xl space-y-5">
        <nav aria-label="Breadcrumb" className="text-sm text-slate-600">
          <Link href="/audit" className="hover:text-slate-900">Audit</Link>
          <span className="mx-2">/</span>
          <span className="text-slate-900">Compliance Tracking</span>
        </nav>

        <header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-3xl font-semibold text-slate-900">Compliance Tracking</h1>
            <p className="mt-1 text-sm text-slate-600">Statutory and regulatory compliance requirements with due dates and evidence.</p>
          </div>
          {source === "error" ? <DataSourceBadge source={source} /> : null}
        </header>

        <section className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Total</p>
            <p className="mt-1 text-2xl font-bold text-slate-900">{total}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Complied</p>
            <p className="mt-1 text-2xl font-bold text-green-600">{complied}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Pending</p>
            <p className="mt-1 text-2xl font-bold text-yellow-600">{pending}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Overdue</p>
            <p className="mt-1 text-2xl font-bold text-red-600">{overdue}</p>
          </div>
        </section>

        <section className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table aria-label="Compliance items" className="min-w-full text-left text-sm">
            <thead className="bg-slate-100 text-slate-700">
              <tr>
                <th scope="col" className="px-4 py-3">Law / Rule</th>
                <th scope="col" className="px-4 py-3">Section</th>
                <th scope="col" className="px-4 py-3">Requirement</th>
                <th scope="col" className="px-4 py-3">Frequency</th>
                <th scope="col" className="px-4 py-3">Due Date</th>
                <th scope="col" className="px-4 py-3">Department</th>
                <th scope="col" className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id} className="border-t border-slate-200 hover:bg-slate-50">
                  <td className="px-4 py-3 text-slate-800">{item.lawOrRule}</td>
                  <td className="px-4 py-3 text-slate-600">{item.section ?? "—"}</td>
                  <td className="px-4 py-3 text-slate-800 max-w-xs truncate">{item.requirement}</td>
                  <td className="px-4 py-3 text-slate-600">{item.frequency}</td>
                  <td className="px-4 py-3 text-slate-600">{item.dueDate}</td>
                  <td className="px-4 py-3 text-slate-600">{item.department ?? "—"}</td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusColors[item.status] ?? "bg-slate-100 text-slate-600"}`}>
                      {item.status}
                    </span>
                  </td>
                </tr>
              ))}
              {items.length === 0 && source !== "error" && (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-sm text-slate-500">
                    <span className="block font-medium text-slate-700">No compliance items</span>
                    <span className="mt-1 block text-slate-400">Compliance requirements will appear here once configured.</span>
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
