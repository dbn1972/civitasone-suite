import Link from "next/link";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { getRiskRegister } from "../../../_data/loaders";

const categoryColors: Record<string, string> = {
  financial: "bg-blue-50 text-blue-700",
  operational: "bg-yellow-50 text-yellow-700",
  compliance: "bg-purple-50 text-purple-700",
  reputational: "bg-orange-50 text-orange-700",
  strategic: "bg-green-50 text-green-700",
  it: "bg-slate-100 text-slate-600",
};

const statusColors: Record<string, string> = {
  open: "bg-red-50 text-red-700",
  mitigated: "bg-yellow-50 text-yellow-700",
  closed: "bg-emerald-50 text-emerald-700",
  escalated: "bg-red-100 text-red-800",
};

function riskScoreColor(score: number): string {
  if (score >= 15) return "text-red-600 font-bold";
  if (score >= 6) return "text-yellow-600 font-semibold";
  return "text-green-600";
}

export default async function RiskRegisterPage() {
  const { data: items, source } = await getRiskRegister();

  const total = items.length;
  const open = items.filter((i) => i.status === "open").length;
  const highRisk = items.filter((i) => i.riskScore >= 15).length;
  const mitigated = items.filter((i) => i.status === "mitigated").length;

  return (
    <main className="min-h-screen bg-slate-50 p-6 md:p-8">
      <section className="mx-auto max-w-7xl space-y-5">
        <nav aria-label="Breadcrumb" className="text-sm text-slate-600">
          <Link href="/audit" className="hover:text-slate-900">Audit</Link>
          <span className="mx-2">/</span>
          <span className="text-slate-900">Risk Register</span>
        </nav>

        <header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-3xl font-semibold text-slate-900">Risk Register</h1>
            <p className="mt-1 text-sm text-slate-600">Enterprise risk inventory with likelihood, impact, and mitigation tracking.</p>
          </div>
          {source === "error" ? <DataSourceBadge source={source} /> : null}
        </header>

        <section className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Total Risks</p>
            <p className="mt-1 text-2xl font-bold text-slate-900">{total}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Open</p>
            <p className="mt-1 text-2xl font-bold text-red-600">{open}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">High Risk (≥15)</p>
            <p className="mt-1 text-2xl font-bold text-orange-600">{highRisk}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Mitigated</p>
            <p className="mt-1 text-2xl font-bold text-green-600">{mitigated}</p>
          </div>
        </section>

        <section className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table aria-label="Risk register" className="min-w-full text-left text-sm">
            <thead className="bg-slate-100 text-slate-700">
              <tr>
                <th scope="col" className="px-4 py-3">Risk Code</th>
                <th scope="col" className="px-4 py-3">Title</th>
                <th scope="col" className="px-4 py-3">Category</th>
                <th scope="col" className="px-4 py-3">Likelihood</th>
                <th scope="col" className="px-4 py-3">Impact</th>
                <th scope="col" className="px-4 py-3 text-right">Score</th>
                <th scope="col" className="px-4 py-3">Owner</th>
                <th scope="col" className="px-4 py-3">Mitigation</th>
                <th scope="col" className="px-4 py-3">Review Date</th>
                <th scope="col" className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id} className="border-t border-slate-200 hover:bg-slate-50">
                  <td className="px-4 py-3 font-mono text-xs text-slate-700">{item.riskCode}</td>
                  <td className="px-4 py-3 text-slate-800 max-w-xs truncate">{item.title}</td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${categoryColors[item.category] ?? "bg-slate-100 text-slate-600"}`}>
                      {item.category}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-600">{item.likelihood.replace(/_/g, " ")}</td>
                  <td className="px-4 py-3 text-slate-600">{item.impact}</td>
                  <td className={`px-4 py-3 text-right tabular-nums ${riskScoreColor(item.riskScore)}`}>{item.riskScore}</td>
                  <td className="px-4 py-3 text-slate-600">{item.owner ?? "—"}</td>
                  <td className="px-4 py-3 text-slate-600">{item.mitigationStatus.replace(/_/g, " ")}</td>
                  <td className="px-4 py-3 text-slate-600">{item.reviewDate ?? "—"}</td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusColors[item.status] ?? "bg-slate-100 text-slate-600"}`}>
                      {item.status}
                    </span>
                  </td>
                </tr>
              ))}
              {items.length === 0 && source !== "error" && (
                <tr>
                  <td colSpan={10} className="px-4 py-10 text-center text-sm text-slate-500">
                    <span className="block font-medium text-slate-700">Risk register is empty</span>
                    <span className="mt-1 block text-slate-400">No risks have been logged yet.</span>
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
