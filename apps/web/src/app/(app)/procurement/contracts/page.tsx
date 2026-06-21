import Link from "next/link";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { getContracts } from "../../../_data/loaders";

export default async function ProcurementContractsPage() {
  const { data: contracts, source } = await getContracts();

  return (
    <main className="min-h-screen bg-slate-50 p-6 md:p-8">
      <section className="mx-auto max-w-7xl space-y-5">
        <nav aria-label="Breadcrumb" className="text-sm text-slate-600">
          <Link href="/procurement" className="hover:text-slate-900">Procurement</Link>
          <span className="mx-2">/</span>
          <span className="text-slate-900">Contracts</span>
        </nav>

        <header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-3xl font-semibold text-slate-900">Contracts</h1>
            <p className="mt-1 text-sm text-slate-600">Active and historical procurement contracts.</p>
          </div>
          {source === "error" ? <DataSourceBadge source={source} /> : null}
        </header>

        <section className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Total Contracts</p>
            <p className="mt-1 text-2xl font-bold text-slate-900">{contracts.length}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Active</p>
            <p className="mt-1 text-2xl font-bold text-emerald-600">
              {contracts.filter((c) => c.status === "active").length}
            </p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Expiring Soon</p>
            <p className="mt-1 text-2xl font-bold text-amber-600">
              {contracts.filter((c) => c.status === "expiring").length}
            </p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Expired</p>
            <p className="mt-1 text-2xl font-bold text-slate-500">
              {contracts.filter((c) => c.status === "expired").length}
            </p>
          </div>
        </section>

        <section className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="min-w-full text-left text-sm" aria-label="Contracts list">
            <thead className="bg-slate-100 text-slate-700">
              <tr>
                <th scope="col" className="px-4 py-3">Contract</th>
                <th scope="col" className="px-4 py-3">Vendor / Counter-party</th>
                <th scope="col" className="px-4 py-3">Type</th>
                <th scope="col" className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {contracts.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-10 text-center text-slate-400">
                    No contracts found
                  </td>
                </tr>
              ) : (
                contracts.map((c) => (
                  <tr key={c.id} className="border-t border-slate-200 hover:bg-slate-50">
                    <td className="px-4 py-3 font-medium text-slate-900">{c.label}</td>
                    <td className="px-4 py-3 text-slate-600">{c.sublabel ?? "—"}</td>
                    <td className="px-4 py-3 text-slate-600">{c.meta ?? "—"}</td>
                    <td className="px-4 py-3">
                      {c.status ? (
                        <span
                          className={`rounded-full px-2 py-1 text-xs font-medium ${
                            c.status === "active"
                              ? "bg-emerald-50 text-emerald-700"
                              : c.status === "expiring"
                                ? "bg-amber-50 text-amber-700"
                                : "bg-slate-100 text-slate-500"
                          }`}
                        >
                          {c.status}
                        </span>
                      ) : (
                        "—"
                      )}
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
