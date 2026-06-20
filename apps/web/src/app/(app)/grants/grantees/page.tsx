import Link from "next/link";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { getGrantees } from "../../../_data/loaders";

const typeColors: Record<string, string> = {
  ngo: "bg-purple-50 text-purple-700",
  government: "bg-blue-50 text-blue-700",
  institution: "bg-emerald-50 text-emerald-700",
  individual: "bg-slate-100 text-slate-600",
};

const typeLabel: Record<string, string> = {
  ngo: "NGO",
  government: "Government",
  institution: "Institution",
  individual: "Individual",
};

function complianceColor(pct: number): string {
  if (pct >= 80) return "text-emerald-600";
  if (pct >= 50) return "text-amber-600";
  return "text-red-600";
}

export default async function GranteesPage() {
  const { data: grantees, source } = await getGrantees();

  const ngos = grantees.filter((g) => g.type === "ngo").length;
  const govts = grantees.filter((g) => g.type === "government").length;
  const institutions = grantees.filter((g) => g.type === "institution").length;

  return (
    <main className="min-h-screen bg-slate-50 p-6 md:p-8">
      <section className="mx-auto max-w-7xl space-y-5">
        <nav aria-label="Breadcrumb" className="text-sm text-slate-600">
          <Link href="/grants" className="hover:text-slate-900">Grants</Link>
          <span className="mx-2">/</span>
          <span className="text-slate-900">Grantees</span>
        </nav>

        <header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-3xl font-semibold text-slate-900">Grantees</h1>
            <p className="mt-1 text-sm text-slate-600">Registered grantee organisations and compliance status.</p>
          </div>
          {source === "error" ? <DataSourceBadge source={source} /> : null}
        </header>

        <section className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Total Grantees</p>
            <p className="mt-1 text-2xl font-bold text-slate-900">{grantees.length}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">NGOs</p>
            <p className="mt-1 text-2xl font-bold text-purple-600">{ngos}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Government</p>
            <p className="mt-1 text-2xl font-bold text-blue-600">{govts}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Institutions</p>
            <p className="mt-1 text-2xl font-bold text-emerald-600">{institutions}</p>
          </div>
        </section>

        <section className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-slate-100 text-slate-700">
              <tr>
                <th className="px-4 py-3">Grantee Code</th>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Registration No</th>
                <th className="px-4 py-3 text-right">Active Grants</th>
                <th className="px-4 py-3 text-right">Total Received (₹)</th>
                <th className="px-4 py-3 text-right">UC Compliance</th>
              </tr>
            </thead>
            <tbody>
              {grantees.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-slate-400">No grantees found</td>
                </tr>
              ) : (
                grantees.map((g) => (
                  <tr key={g.id} className="border-t border-slate-200 hover:bg-slate-50">
                    <td className="px-4 py-3 font-mono text-xs text-slate-900">{g.granteeCode}</td>
                    <td className="px-4 py-3 text-slate-800">{g.name}</td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2 py-1 text-xs font-medium ${typeColors[g.type] ?? "bg-slate-100 text-slate-600"}`}>
                        {typeLabel[g.type] ?? g.type}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-600">{g.registrationNo ?? "—"}</td>
                    <td className="px-4 py-3 text-right text-slate-700">{g.activeGrants}</td>
                    <td className="px-4 py-3 text-right text-slate-800">₹{(g.totalGrantsReceived / 100).toLocaleString("en-IN")}</td>
                    <td className="px-4 py-3 text-right">
                      <span className={`font-medium ${complianceColor(g.ucCompliancePct)}`}>
                        {g.ucCompliancePct.toFixed(1)}%
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
