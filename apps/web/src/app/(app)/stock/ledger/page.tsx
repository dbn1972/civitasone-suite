import Link from "next/link";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { getStockLedger } from "../../../_data/loaders";

const typeColors: Record<string, string> = {
  receipt: "bg-emerald-50 text-emerald-700",
  issue: "bg-red-50 text-red-700",
  transfer: "bg-blue-50 text-blue-700",
  adjustment: "bg-amber-50 text-amber-700",
};

export default async function StockLedgerPage() {
  const { data: entries, source } = await getStockLedger();

  const totalReceipts = entries
    .filter((e) => e.type === "receipt")
    .reduce((sum, e) => sum + e.totalValue, 0);
  const totalIssues = entries
    .filter((e) => e.type === "issue")
    .reduce((sum, e) => sum + e.totalValue, 0);
  const netBalance = totalReceipts - totalIssues;

  return (
    <main className="min-h-screen bg-slate-50 p-6 md:p-8">
      <section className="mx-auto max-w-7xl space-y-5">
        <nav aria-label="Breadcrumb" className="text-sm text-slate-600">
          <Link href="/stock" className="hover:text-slate-900">Stock</Link>
          <span className="mx-2">/</span>
          <span className="text-slate-900">Ledger</span>
        </nav>

        <header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-3xl font-semibold text-slate-900">Stock Ledger</h1>
            <p className="mt-1 text-sm text-slate-600">All receipt, issue, transfer and adjustment transactions.</p>
          </div>
          {source === "error" ? <DataSourceBadge source={source} /> : null}
        </header>

        <section className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Total Entries</p>
            <p className="mt-1 text-2xl font-bold text-slate-900">{entries.length.toLocaleString("en-IN")}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Total Receipts (₹)</p>
            <p className="mt-1 text-2xl font-bold text-emerald-600">₹{(totalReceipts / 100).toLocaleString("en-IN")}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Total Issues (₹)</p>
            <p className="mt-1 text-2xl font-bold text-red-600">₹{(totalIssues / 100).toLocaleString("en-IN")}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Net Balance (₹)</p>
            <p className={`mt-1 text-2xl font-bold ${netBalance >= 0 ? "text-blue-600" : "text-red-600"}`}>
              ₹{(netBalance / 100).toLocaleString("en-IN")}
            </p>
          </div>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-slate-100 text-slate-700">
                <tr>
                  <th className="px-4 py-3">Item Code</th>
                  <th className="px-4 py-3">Item Name</th>
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3">Type</th>
                  <th className="px-4 py-3 text-right">Quantity</th>
                  <th className="px-4 py-3 text-right">Unit Cost (₹)</th>
                  <th className="px-4 py-3 text-right">Total Value (₹)</th>
                  <th className="px-4 py-3">Reference</th>
                  <th className="px-4 py-3">Party</th>
                  <th className="px-4 py-3 text-right">Balance</th>
                </tr>
              </thead>
              <tbody>
                {entries.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="px-4 py-6 text-center text-slate-400">No ledger entries found</td>
                  </tr>
                ) : (
                  entries.map((entry) => (
                    <tr key={entry.id} className="border-t border-slate-200 hover:bg-slate-50">
                      <td className="px-4 py-3 font-mono text-xs text-blue-600">{entry.itemCode}</td>
                      <td className="px-4 py-3 font-medium text-slate-900">{entry.itemName}</td>
                      <td className="px-4 py-3 text-slate-600">{entry.date}</td>
                      <td className="px-4 py-3">
                        <span className={`rounded-full px-2 py-1 text-xs font-medium ${typeColors[entry.type] ?? "bg-slate-100 text-slate-600"}`}>
                          {entry.type}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right text-slate-800">{entry.quantity.toLocaleString("en-IN")}</td>
                      <td className="px-4 py-3 text-right text-slate-800">₹{(entry.unitCost / 100).toLocaleString("en-IN")}</td>
                      <td className="px-4 py-3 text-right text-slate-800">₹{(entry.totalValue / 100).toLocaleString("en-IN")}</td>
                      <td className="px-4 py-3 font-mono text-xs text-slate-600">{entry.referenceNo ?? "—"}</td>
                      <td className="px-4 py-3 text-slate-600">{entry.party ?? "—"}</td>
                      <td className="px-4 py-3 text-right font-medium text-slate-900">{entry.balance.toLocaleString("en-IN")}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      </section>
    </main>
  );
}
