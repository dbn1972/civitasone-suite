import Link from "next/link";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { getCourtOrders } from "../../../_data/loaders";

const statusColors: Record<string, string> = {
  pending: "bg-yellow-50 text-yellow-700",
  complied: "bg-emerald-50 text-emerald-700",
  appealed: "bg-blue-50 text-blue-700",
  stayed: "bg-slate-100 text-slate-600",
};

export default async function CourtOrdersPage() {
  const { data: items, source } = await getCourtOrders();

  const today = new Date().toISOString().slice(0, 10);
  const soonThreshold = new Date(Date.now() + 7 * 86400_000).toISOString().slice(0, 10);

  const total = items.length;
  const pendingCompliance = items.filter((i) => i.complianceRequired && i.status === "pending").length;
  const complied = items.filter((i) => i.status === "complied").length;
  const requiresAction = items.filter(
    (i) => i.complianceRequired && i.status === "pending" && i.complianceDeadline && i.complianceDeadline <= soonThreshold,
  ).length;

  return (
    <main className="min-h-screen bg-slate-50 p-6 md:p-8">
      <section className="mx-auto max-w-7xl space-y-5">
        <nav aria-label="Breadcrumb" className="text-sm text-slate-600">
          <Link href="/legal" className="hover:text-slate-900">Legal</Link>
          <span className="mx-2">/</span>
          <span className="text-slate-900">Court Orders</span>
        </nav>

        <header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-3xl font-semibold text-slate-900">Court Orders</h1>
            <p className="mt-1 text-sm text-slate-600">Compliance-tracked court orders across all cases.</p>
          </div>
          {source === "error" ? <DataSourceBadge source={source} /> : null}
        </header>

        <section className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Total</p>
            <p className="mt-1 text-2xl font-bold text-slate-900">{total}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Pending Compliance</p>
            <p className="mt-1 text-2xl font-bold text-yellow-600">{pendingCompliance}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Complied</p>
            <p className="mt-1 text-2xl font-bold text-green-600">{complied}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Due This Week</p>
            <p className="mt-1 text-2xl font-bold text-red-600">{requiresAction}</p>
          </div>
        </section>

        <section className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table aria-label="Court orders" className="min-w-full text-left text-sm">
            <thead className="bg-slate-100 text-slate-700">
              <tr>
                <th scope="col" className="px-4 py-3">Case No</th>
                <th scope="col" className="px-4 py-3">Court</th>
                <th scope="col" className="px-4 py-3">Order Date</th>
                <th scope="col" className="px-4 py-3">Order No</th>
                <th scope="col" className="px-4 py-3">Summary</th>
                <th scope="col" className="px-4 py-3">Compliance Required</th>
                <th scope="col" className="px-4 py-3">Deadline</th>
                <th scope="col" className="px-4 py-3">Department</th>
                <th scope="col" className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => {
                const deadlineUrgent =
                  item.complianceRequired &&
                  item.status === "pending" &&
                  item.complianceDeadline &&
                  item.complianceDeadline <= soonThreshold &&
                  item.complianceDeadline >= today;
                return (
                  <tr key={item.id} className="border-t border-slate-200 hover:bg-slate-50">
                    <td className="px-4 py-3 font-mono text-xs text-slate-700">
                      <Link href={`/legal/cases/${item.caseId}`} className="text-indigo-600 hover:underline">
                        {item.caseNo}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-slate-600">{item.court}</td>
                    <td className="px-4 py-3 text-slate-800">{item.orderDate}</td>
                    <td className="px-4 py-3 text-slate-600">{item.orderNo ?? "—"}</td>
                    <td className="px-4 py-3 text-slate-800 max-w-xs truncate">{item.summary}</td>
                    <td className="px-4 py-3">
                      {item.complianceRequired ? (
                        <span className="rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700">Yes</span>
                      ) : (
                        <span className="text-slate-400 text-xs">No</span>
                      )}
                    </td>
                    <td className={`px-4 py-3 ${deadlineUrgent ? "font-semibold text-red-600" : "text-slate-600"}`}>
                      {item.complianceDeadline ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-slate-600">{item.department ?? "—"}</td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusColors[item.status] ?? "bg-slate-100 text-slate-600"}`}>
                        {item.status}
                      </span>
                    </td>
                  </tr>
                );
              })}
              {items.length === 0 && source !== "error" && (
                <tr>
                  <td colSpan={9} className="px-4 py-10 text-center text-sm text-slate-500">
                    <span className="block font-medium text-slate-700">No court orders yet</span>
                    <span className="mt-1 block text-slate-400">Court orders will appear here once recorded against cases.</span>
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
