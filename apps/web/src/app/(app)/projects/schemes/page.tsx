import Link from "next/link";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { getSchemes } from "../../../_data/loaders";

const fundingTypeColors: Record<string, string> = {
  central: "bg-blue-50 text-blue-700",
  state: "bg-emerald-50 text-emerald-700",
  centrally_sponsored: "bg-purple-50 text-purple-700",
  external: "bg-orange-50 text-orange-700",
};

const fundingTypeLabel: Record<string, string> = {
  central: "Central",
  state: "State",
  centrally_sponsored: "CSS",
  external: "External",
};

const statusColors: Record<string, string> = {
  active: "bg-emerald-50 text-emerald-700",
  completed: "bg-slate-100 text-slate-600",
  discontinued: "bg-red-50 text-red-700",
};

export default async function SchemesPage() {
  const { data: schemes, source } = await getSchemes();

  const active = schemes.filter((s) => s.status === "active").length;
  const totalProjects = schemes.reduce((sum, s) => sum + s.projectCount, 0);
  const totalAllocation = schemes.reduce((sum, s) => sum + s.totalAllocation, 0);

  return (
    <main className="min-h-screen bg-slate-50 p-6 md:p-8">
      <section className="mx-auto max-w-7xl space-y-5">
        <nav aria-label="Breadcrumb" className="text-sm text-slate-600">
          <Link href="/projects" className="hover:text-slate-900">Projects</Link>
          <span className="mx-2">/</span>
          <span className="text-slate-900">Schemes</span>
        </nav>

        <header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-3xl font-semibold text-slate-900">Schemes</h1>
            <p className="mt-1 text-sm text-slate-600">Government scheme catalog with allocations and project counts.</p>
          </div>
          {source === "error" ? <DataSourceBadge source={source} /> : null}
        </header>

        <section className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Total Schemes</p>
            <p className="mt-1 text-2xl font-bold text-slate-900">{schemes.length}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Active</p>
            <p className="mt-1 text-2xl font-bold text-emerald-600">{active}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Projects</p>
            <p className="mt-1 text-2xl font-bold text-blue-600">{totalProjects.toLocaleString("en-IN")}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Total Allocation (₹)</p>
            <p className="mt-1 text-2xl font-bold text-slate-900">₹{(totalAllocation / 100).toLocaleString("en-IN")}</p>
          </div>
        </section>

        <section className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table aria-label="Schemes" className="min-w-full text-left text-sm">
            <thead className="bg-slate-100 text-slate-700">
              <tr>
                <th className="px-4 py-3">Scheme Code</th>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Ministry</th>
                <th className="px-4 py-3">Department</th>
                <th className="px-4 py-3">Funding Type</th>
                <th className="px-4 py-3 text-right">Allocation (₹)</th>
                <th className="px-4 py-3 text-right">Released (₹)</th>
                <th className="px-4 py-3 text-right">Projects</th>
                <th className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {schemes.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-8 text-center text-slate-400">No schemes found</td>
                </tr>
              ) : (
                schemes.map((s) => (
                  <tr key={s.id} className="border-t border-slate-200 hover:bg-slate-50">
                    <td className="px-4 py-3 font-mono text-xs text-slate-900">{s.schemeCode}</td>
                    <td className="px-4 py-3 text-slate-800 max-w-xs truncate">{s.name}</td>
                    <td className="px-4 py-3 text-slate-600">{s.ministry ?? "—"}</td>
                    <td className="px-4 py-3 text-slate-600">{s.department ?? "—"}</td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2 py-1 text-xs font-medium ${fundingTypeColors[s.fundingType] ?? "bg-slate-100 text-slate-600"}`}>
                        {fundingTypeLabel[s.fundingType] ?? s.fundingType}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right text-slate-800">₹{(s.totalAllocation / 100).toLocaleString("en-IN")}</td>
                    <td className="px-4 py-3 text-right text-slate-800">₹{(s.releasedAmount / 100).toLocaleString("en-IN")}</td>
                    <td className="px-4 py-3 text-right text-slate-700">{s.projectCount}</td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2 py-1 text-xs font-medium ${statusColors[s.status] ?? "bg-slate-100 text-slate-600"}`}>
                        {s.status}
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
