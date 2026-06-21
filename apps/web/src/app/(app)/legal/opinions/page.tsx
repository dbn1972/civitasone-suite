import Link from "next/link";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { getLegalOpinions } from "../../../_data/loaders";

const statusColors: Record<string, string> = {
  pending: "bg-yellow-50 text-yellow-700",
  draft: "bg-blue-50 text-blue-700",
  issued: "bg-emerald-50 text-emerald-700",
  revised: "bg-orange-50 text-orange-700",
};

export default async function LegalOpinionsPage() {
  const { data: items, source } = await getLegalOpinions();

  const today = new Date().toISOString().slice(0, 10);

  const total = items.length;
  const pending = items.filter((i) => i.status === "pending").length;
  const issued = items.filter((i) => i.status === "issued").length;
  const overdue = items.filter(
    (i) => i.dueDate && i.dueDate < today && i.status !== "issued",
  ).length;

  return (
    <main className="min-h-screen bg-slate-50 p-6 md:p-8">
      <section className="mx-auto max-w-7xl space-y-5">
        <nav aria-label="Breadcrumb" className="text-sm text-slate-600">
          <Link href="/legal" className="hover:text-slate-900">Legal</Link>
          <span className="mx-2">/</span>
          <span className="text-slate-900">Legal Opinions</span>
        </nav>

        <header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-3xl font-semibold text-slate-900">Legal Opinions</h1>
            <p className="mt-1 text-sm text-slate-600">In-house and external legal opinions requested by departments.</p>
          </div>
          {source === "error" ? <DataSourceBadge source={source} /> : null}
        </header>

        <section className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Total</p>
            <p className="mt-1 text-2xl font-bold text-slate-900">{total}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Pending</p>
            <p className="mt-1 text-2xl font-bold text-yellow-600">{pending}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Issued</p>
            <p className="mt-1 text-2xl font-bold text-green-600">{issued}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Overdue</p>
            <p className="mt-1 text-2xl font-bold text-red-600">{overdue}</p>
          </div>
        </section>

        <section className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table aria-label="Legal opinions" className="min-w-full text-left text-sm">
            <thead className="bg-slate-100 text-slate-700">
              <tr>
                <th scope="col" className="px-4 py-3">Opinion No</th>
                <th scope="col" className="px-4 py-3">Subject</th>
                <th scope="col" className="px-4 py-3">Requested By</th>
                <th scope="col" className="px-4 py-3">Request Date</th>
                <th scope="col" className="px-4 py-3">Due Date</th>
                <th scope="col" className="px-4 py-3">Advisor</th>
                <th scope="col" className="px-4 py-3">Status</th>
                <th scope="col" className="px-4 py-3">Issued Date</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => {
                const isOverdue = item.dueDate && item.dueDate < today && item.status !== "issued";
                return (
                  <tr key={item.id} className="border-t border-slate-200 hover:bg-slate-50">
                    <td className="px-4 py-3 font-mono text-xs text-slate-700">{item.opinionNo}</td>
                    <td className="px-4 py-3 text-slate-800 max-w-xs truncate">{item.subject}</td>
                    <td className="px-4 py-3 text-slate-600">{item.requestedBy}</td>
                    <td className="px-4 py-3 text-slate-600">{item.requestDate}</td>
                    <td className={`px-4 py-3 ${isOverdue ? "font-semibold text-red-600" : "text-slate-600"}`}>
                      {item.dueDate ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-slate-600">{item.advisorName ?? "—"}</td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusColors[item.status] ?? "bg-slate-100 text-slate-600"}`}>
                        {item.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-600">{item.issuedDate ?? "—"}</td>
                  </tr>
                );
              })}
              {items.length === 0 && source !== "error" && (
                <tr>
                  <td colSpan={8} className="px-4 py-10 text-center text-sm text-slate-500">
                    <span className="block font-medium text-slate-700">No opinions yet</span>
                    <span className="mt-1 block text-slate-400">Legal opinions will appear here once requested.</span>
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
