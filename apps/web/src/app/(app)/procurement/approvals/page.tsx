import Link from "next/link";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { getProcurementApprovals } from "../../../_data/loaders";

export default async function Page() {
  const { data: approvals, source } = await getProcurementApprovals();

  return (
    <main className="min-h-screen bg-slate-50 p-6 md:p-8">
      <section className="mx-auto max-w-7xl space-y-5">
        <nav aria-label="Breadcrumb" className="text-sm text-slate-600">
          <Link href="/procurement" className="hover:text-slate-900">Procurement</Link>
          <span className="mx-2">/</span>
          <span className="text-slate-900">Approvals</span>
        </nav>

        <header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-3xl font-semibold text-slate-900">Procurement Approvals</h1>
            <p className="mt-1 text-sm text-slate-600">Pending items requiring policy and budget sign-off.</p>
          </div>
          {source === "error" ? <DataSourceBadge source={source} /> : null}
        </header>

        <section className="grid grid-cols-2 gap-4 md:grid-cols-3">
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Total Pending</p>
            <p className="mt-1 text-2xl font-bold text-slate-900">{approvals.length}</p>
          </div>
        </section>

        <section className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="min-w-full text-left text-sm" aria-label="Pending approvals">
            <thead className="bg-slate-100 text-slate-700">
              <tr>
                <th scope="col" className="px-4 py-3">Approval ID</th>
                <th scope="col" className="px-4 py-3">Reference</th>
                <th scope="col" className="px-4 py-3">Owner</th>
                <th scope="col" className="px-4 py-3">Due</th>
              </tr>
            </thead>
            <tbody>
              {approvals.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-10 text-center text-slate-400">
                    No pending approvals
                  </td>
                </tr>
              ) : (
                approvals.map((item) => (
                  <tr key={item.id} className="border-t border-slate-200 hover:bg-slate-50">
                    <td className="px-4 py-3 font-mono text-xs text-slate-700">{item.id}</td>
                    <td className="px-4 py-3 font-medium text-indigo-600">{item.referenceId}</td>
                    <td className="px-4 py-3 text-slate-700">{item.owner}</td>
                    <td className="px-4 py-3 text-slate-600">{item.dueDisplay}</td>
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
