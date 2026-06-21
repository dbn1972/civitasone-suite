import Link from "next/link";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { getStockLedger } from "../../../_data/loaders";

const typeColors: Record<string, string> = {
  receipt: "bg-emerald-50 text-emerald-700",
  issue: "bg-red-50 text-red-700",
  transfer: "bg-blue-50 text-blue-700",
  adjustment: "bg-amber-50 text-amber-700",
};

export default async function InventoryReconcilePage() {
  const { data: entries, source } = await getStockLedger();

  const receipts = entries.filter((e) => e.type === "receipt");
  const issues = entries.filter((e) => e.type === "issue");
  const adjustments = entries.filter((e) => e.type === "adjustment");

  const totalIn = receipts.reduce((s, e) => s + e.quantity, 0);
  const totalOut = issues.reduce((s, e) => s + e.quantity, 0);
  const totalAdjusted = adjustments.reduce((s, e) => s + e.quantity, 0);
  const netQty = totalIn - totalOut + totalAdjusted;

  return (
    <main className="min-h-screen bg-slate-50 p-6 md:p-8">
      <section className="mx-auto max-w-7xl space-y-5">
        <nav aria-label="Breadcrumb" className="text-sm text-slate-600">
          <Link href="/inventory" className="hover:text-slate-900">Inventory</Link>
          <span className="mx-2">/</span>
          <span className="text-slate-900">Reconciliation</span>
        </nav>

        <header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-3xl font-semibold text-slate-900">Inventory Reconciliation</h1>
            <p className="mt-1 text-sm text-slate-600">
              Compare physical stock movements — receipts, issues and adjustments — to verify ledger balance.
            </p>
          </div>
          {source === "error" ? <DataSourceBadge source={source} /> : null}
        </header>

        {entries.length === 0 && source !== "error" ? (
          <div className="rounded-xl border border-slate-200 bg-white p-10 text-center shadow-sm">
            <p className="text-slate-500">No stock movements to reconcile.</p>
            <p className="mt-1 text-xs text-slate-400">Record receipts or issues in Stock to begin reconciliation.</p>
          </div>
        ) : (
          <>
            <section className="grid grid-cols-2 gap-4 md:grid-cols-4">
              <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <p className="text-sm text-slate-500">Total In (Qty)</p>
                <p className="mt-1 text-2xl font-bold text-emerald-600">{totalIn.toLocaleString("en-IN")}</p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <p className="text-sm text-slate-500">Total Out (Qty)</p>
                <p className="mt-1 text-2xl font-bold text-red-600">{totalOut.toLocaleString("en-IN")}</p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <p className="text-sm text-slate-500">Adjustments</p>
                <p className="mt-1 text-2xl font-bold text-amber-600">{adjustments.length.toLocaleString("en-IN")}</p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <p className="text-sm text-slate-500">Net Balance (Qty)</p>
                <p className={`mt-1 text-2xl font-bold ${netQty >= 0 ? "text-blue-600" : "text-red-600"}`}>
                  {netQty.toLocaleString("en-IN")}
                </p>
              </div>
            </section>

            <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
              <div className="overflow-x-auto">
                <table aria-label="Inventory reconciliation ledger" className="min-w-full text-left text-sm">
                  <thead className="bg-slate-100 text-slate-700">
                    <tr>
                      <th scope="col" className="px-4 py-3">Item Code</th>
                      <th scope="col" className="px-4 py-3">Item Name</th>
                      <th scope="col" className="px-4 py-3">Date</th>
                      <th scope="col" className="px-4 py-3">Movement</th>
                      <th scope="col" className="px-4 py-3 text-right">Quantity</th>
                      <th scope="col" className="px-4 py-3 text-right">Value (₹)</th>
                      <th scope="col" className="px-4 py-3">Reference</th>
                      <th scope="col" className="px-4 py-3 text-right">Balance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {entries.map((entry) => (
                      <tr key={entry.id} className="border-t border-slate-200 hover:bg-slate-50">
                        <td className="px-4 py-3 font-mono text-xs text-blue-600">{entry.itemCode}</td>
                        <td className="px-4 py-3 font-medium text-slate-900">{entry.itemName}</td>
                        <td className="px-4 py-3 text-slate-600">{entry.date}</td>
                        <td className="px-4 py-3">
                          <span className={`rounded-full px-2 py-1 text-xs font-medium ${typeColors[entry.type] ?? "bg-slate-100 text-slate-600"}`}>
                            {entry.type}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right text-slate-800">
                          {entry.type === "issue" ? "-" : "+"}{entry.quantity.toLocaleString("en-IN")}
                        </td>
                        <td className="px-4 py-3 text-right text-slate-800">₹{(entry.totalValue / 100).toLocaleString("en-IN")}</td>
                        <td className="px-4 py-3 font-mono text-xs text-slate-600">{entry.referenceNo ?? "—"}</td>
                        <td className="px-4 py-3 text-right font-medium text-slate-900">{entry.balance.toLocaleString("en-IN")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}
      </section>
    </main>
  );
}
