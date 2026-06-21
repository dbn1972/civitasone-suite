import Link from "next/link";
import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { getFinancialStatements } from "../../../../_data/loaders";

const typeColors: Record<string, string> = {
  asset: "bg-blue-50 text-blue-700",
  liability: "bg-purple-50 text-purple-700",
  income: "bg-emerald-50 text-emerald-700",
  expenditure: "bg-red-50 text-red-700",
};

export default async function FinancialStatementsPage() {
  const { data: statements, source } = await getFinancialStatements();

  const totalReceipts = statements.filter((s) => s.type === "income").reduce((sum, s) => sum + s.receipts, 0);
  const totalPayments = statements.filter((s) => s.type === "expenditure").reduce((sum, s) => sum + s.payments, 0);
  const totalAssets = statements.filter((s) => s.type === "asset").reduce((sum, s) => sum + s.closingBalance, 0);
  const totalLiabilities = statements.filter((s) => s.type === "liability").reduce((sum, s) => sum + s.closingBalance, 0);

  return (
    <main className="min-h-screen bg-slate-50 p-6 md:p-8">
      <section className="mx-auto max-w-7xl space-y-5">
        <nav aria-label="Breadcrumb" className="text-sm text-slate-600">
          <Link href="/finance" className="hover:text-slate-900">Finance</Link>
          <span className="mx-2">/</span>
          <span className="text-slate-900">Financial Statements</span>
        </nav>

        <header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-3xl font-semibold text-slate-900">Financial Statements</h1>
            <p className="mt-1 text-sm text-slate-600">Receipts, payments, and balance sheet summary by account head.</p>
          </div>
          {source === "error" ? <DataSourceBadge source={source} /> : null}
        </header>

        <section className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Total Receipts</p>
            <p className="mt-1 text-2xl font-bold text-emerald-600">₹{(totalReceipts / 100).toLocaleString("en-IN")}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Total Payments</p>
            <p className="mt-1 text-2xl font-bold text-red-600">₹{(totalPayments / 100).toLocaleString("en-IN")}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Total Assets</p>
            <p className="mt-1 text-2xl font-bold text-blue-600">₹{(totalAssets / 100).toLocaleString("en-IN")}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Total Liabilities</p>
            <p className="mt-1 text-2xl font-bold text-purple-600">₹{(totalLiabilities / 100).toLocaleString("en-IN")}</p>
          </div>
        </section>

        <section className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="min-w-full text-left text-sm" aria-label="Financial statements">
            <thead className="bg-slate-100 text-slate-700">
              <tr>
                <th scope="col" className="px-4 py-3">Head</th>
                <th scope="col" className="px-4 py-3">Type</th>
                <th scope="col" className="px-4 py-3 text-right">Opening Balance (₹)</th>
                <th scope="col" className="px-4 py-3 text-right">Receipts (₹)</th>
                <th scope="col" className="px-4 py-3 text-right">Payments (₹)</th>
                <th scope="col" className="px-4 py-3 text-right">Closing Balance (₹)</th>
              </tr>
            </thead>
            <tbody>
              {statements.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-slate-400">No financial statement data found</td>
                </tr>
              ) : (
                statements.map((s) => (
                  <tr key={s.id} className="border-t border-slate-200 hover:bg-slate-50">
                    <td className="px-4 py-3 font-medium text-slate-900">{s.head}</td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2 py-1 text-xs capitalize font-medium ${typeColors[s.type]}`}>{s.type}</span>
                    </td>
                    <td className="px-4 py-3 text-right text-slate-700">₹{(s.openingBalance / 100).toLocaleString("en-IN")}</td>
                    <td className="px-4 py-3 text-right text-emerald-700">₹{(s.receipts / 100).toLocaleString("en-IN")}</td>
                    <td className="px-4 py-3 text-right text-red-700">₹{(s.payments / 100).toLocaleString("en-IN")}</td>
                    <td className="px-4 py-3 text-right font-semibold text-slate-900">₹{(s.closingBalance / 100).toLocaleString("en-IN")}</td>
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
