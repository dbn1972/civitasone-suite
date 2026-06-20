import Link from "next/link";
import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { getFinanceGLEntries } from "../../../../_data/loaders";

export default async function GeneralLedgerPage() {
  const { data: entries, source } = await getFinanceGLEntries();

  const totalDebit = entries.reduce((s, e) => s + e.debit, 0);
  const totalCredit = entries.reduce((s, e) => s + e.credit, 0);
  const isBalanced = totalDebit === totalCredit;

  return (
    <main className="min-h-screen bg-slate-50 p-6 md:p-8">
      <section className="mx-auto max-w-7xl space-y-5">
        <nav aria-label="Breadcrumb" className="text-sm text-slate-600">
          <Link href="/finance" className="hover:text-slate-900">Finance</Link>
          <span className="mx-2">/</span>
          <span className="text-slate-900">General Ledger</span>
        </nav>

        <header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-3xl font-semibold text-slate-900">General Ledger</h1>
            <p className="mt-1 text-sm text-slate-600">All posted journal entries with debit and credit detail.</p>
          </div>
          <div className="flex items-center gap-2">
            {source === "error" ? <DataSourceBadge source={source} /> : null}
            <Link href="/finance/accounting/vouchers/new" className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500">
              + New Voucher
            </Link>
          </div>
        </header>

        <section className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Total Entries</p>
            <p className="mt-1 text-2xl font-bold text-slate-900">{entries.length}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Total Debit</p>
            <p className="mt-1 text-2xl font-bold text-red-600">₹{(totalDebit / 100).toLocaleString("en-IN")}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Total Credit</p>
            <p className="mt-1 text-2xl font-bold text-emerald-600">₹{(totalCredit / 100).toLocaleString("en-IN")}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Balance</p>
            <p className={`mt-1 text-2xl font-bold ${isBalanced ? "text-emerald-600" : "text-red-600"}`}>
              {isBalanced ? "Balanced" : "Unbalanced"}
            </p>
          </div>
        </section>

        <section className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-slate-100 text-slate-700">
              <tr>
                <th className="px-4 py-3">Voucher No</th>
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3">Account Code</th>
                <th className="px-4 py-3">Account Name</th>
                <th className="px-4 py-3 text-right">Debit (₹)</th>
                <th className="px-4 py-3 text-right">Credit (₹)</th>
                <th className="px-4 py-3">Narration</th>
                <th className="px-4 py-3">Reference</th>
              </tr>
            </thead>
            <tbody>
              {entries.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-slate-400">No GL entries found</td>
                </tr>
              ) : (
                entries.map((e) => (
                  <tr key={e.id} className="border-t border-slate-200 hover:bg-slate-50">
                    <td className="px-4 py-3 font-mono text-xs text-slate-900">{e.voucherNo}</td>
                    <td className="px-4 py-3 text-slate-600">{e.date}</td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-700">{e.accountCode}</td>
                    <td className="px-4 py-3 text-slate-800">{e.accountName}</td>
                    <td className="px-4 py-3 text-right text-red-700">{e.debit > 0 ? `₹${(e.debit / 100).toLocaleString("en-IN")}` : "—"}</td>
                    <td className="px-4 py-3 text-right text-emerald-700">{e.credit > 0 ? `₹${(e.credit / 100).toLocaleString("en-IN")}` : "—"}</td>
                    <td className="px-4 py-3 max-w-xs truncate text-slate-500">{e.narration ?? "—"}</td>
                    <td className="px-4 py-3 text-slate-500">{e.referenceNo ?? "—"}</td>
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
