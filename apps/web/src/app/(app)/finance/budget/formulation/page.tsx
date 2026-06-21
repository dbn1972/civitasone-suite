import Link from "next/link";
import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { getFinanceBudgets } from "../../../../_data/loaders";

const statusColors: Record<string, string> = {
  approved: "bg-emerald-50 text-emerald-700",
  pending: "bg-amber-50 text-amber-700",
  rejected: "bg-red-50 text-red-700",
  draft: "bg-slate-100 text-slate-600",
};

export default async function BudgetFormulationPage() {
  const { data: budgets, source } = await getFinanceBudgets();

  const totalSanctioned = budgets.reduce((s, b) => s + b.sanctionedAmount, 0);
  const totalExpenditure = budgets.reduce((s, b) => s + b.expenditure, 0);
  const utilPct = totalSanctioned > 0 ? ((totalExpenditure / totalSanctioned) * 100).toFixed(1) : "0.0";

  return (
    <main className="min-h-screen bg-slate-50 p-6 md:p-8">
      <section className="mx-auto max-w-7xl space-y-5">
        <nav aria-label="Breadcrumb" className="text-sm text-slate-600">
          <Link href="/finance" className="hover:text-slate-900">Finance</Link>
          <span className="mx-2">/</span>
          <Link href="/finance/budget/formulation" className="hover:text-slate-900">Budget</Link>
          <span className="mx-2">/</span>
          <span className="text-slate-900">Formulation</span>
        </nav>

        <header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-3xl font-semibold text-slate-900">Budget Formulation</h1>
            <p className="mt-1 text-sm text-slate-600">Sanctioned, released, and utilisation by major head.</p>
          </div>
          <div className="flex items-center gap-2">
            {source === "error" ? <DataSourceBadge source={source} /> : null}
            <Link href="/finance/budget/sanctions/new" className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500">
              + New Budget
            </Link>
          </div>
        </header>

        <section className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Total Budgets</p>
            <p className="mt-1 text-2xl font-bold text-slate-900">{budgets.length}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Sanctioned Amount</p>
            <p className="mt-1 text-2xl font-bold text-blue-600">₹{(totalSanctioned / 100).toLocaleString("en-IN")}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Expenditure</p>
            <p className="mt-1 text-2xl font-bold text-red-600">₹{(totalExpenditure / 100).toLocaleString("en-IN")}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Utilisation %</p>
            <p className="mt-1 text-2xl font-bold text-green-600">{utilPct}%</p>
          </div>
        </section>

        <section className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="min-w-full text-left text-sm" aria-label="Budget formulation records">
            <thead className="bg-slate-100 text-slate-700">
              <tr>
                <th scope="col" className="px-4 py-3">Major Head</th>
                <th scope="col" className="px-4 py-3">Sub Head</th>
                <th scope="col" className="px-4 py-3 text-right">Sanctioned (₹)</th>
                <th scope="col" className="px-4 py-3 text-right">Released (₹)</th>
                <th scope="col" className="px-4 py-3 text-right">Expenditure (₹)</th>
                <th scope="col" className="px-4 py-3 text-right">Balance (₹)</th>
                <th scope="col" className="px-4 py-3">FY</th>
                <th scope="col" className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {budgets.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-slate-400">No budget records found</td>
                </tr>
              ) : (
                budgets.map((b) => (
                  <tr key={b.id} className="border-t border-slate-200 hover:bg-slate-50">
                    <td className="px-4 py-3 font-medium text-slate-900">{b.majorHead}</td>
                    <td className="px-4 py-3 text-slate-600">{b.subHead ?? "—"}</td>
                    <td className="px-4 py-3 text-right text-slate-800">₹{(b.sanctionedAmount / 100).toLocaleString("en-IN")}</td>
                    <td className="px-4 py-3 text-right text-slate-800">₹{(b.releasedAmount / 100).toLocaleString("en-IN")}</td>
                    <td className="px-4 py-3 text-right text-slate-800">₹{(b.expenditure / 100).toLocaleString("en-IN")}</td>
                    <td className="px-4 py-3 text-right font-medium text-slate-900">₹{(b.balance / 100).toLocaleString("en-IN")}</td>
                    <td className="px-4 py-3 text-slate-600">{b.financialYear}</td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2 py-1 text-xs font-medium ${statusColors[b.status] ?? "bg-slate-100 text-slate-600"}`}>
                        {b.status}
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
