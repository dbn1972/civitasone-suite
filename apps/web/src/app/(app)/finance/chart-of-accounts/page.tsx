import Link from "next/link";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { getChartOfAccounts } from "../../../_data/loaders";

export default async function ChartOfAccountsPage() {
  const { data: accounts, source } = await getChartOfAccounts();

  return (
    <main className="min-h-screen bg-slate-50 p-6 md:p-8">
      <section className="mx-auto max-w-7xl space-y-5">
        <nav aria-label="Breadcrumb" className="text-sm text-slate-600">
          <Link href="/finance" className="hover:text-slate-900">
            Finance
          </Link>
          <span className="mx-2">/</span>
          <span className="text-slate-900">Chart of Accounts</span>
        </nav>

        <header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-3xl font-semibold text-slate-900">Chart of Accounts</h1>
            <p className="mt-1 text-sm text-slate-600">Search and manage account hierarchy for your tenant.</p>
          </div>
          <div className="flex items-center gap-2">
            {source === "error" ? <DataSourceBadge source={source} /> : null}
            <button className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100">
              Import
            </button>
            <button className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500">
              New account
            </button>
          </div>
        </header>

        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="grid gap-3 md:grid-cols-4">
            <input
              className="rounded-md border border-slate-300 px-3 py-2 text-sm"
              placeholder="Search code or name"
              aria-label="Search code or name"
            />
            <select className="rounded-md border border-slate-300 px-3 py-2 text-sm" defaultValue="all" aria-label="Account type">
              <option value="all">All Types</option>
              <option value="asset">Asset</option>
              <option value="liability">Liability</option>
              <option value="equity">Equity</option>
              <option value="income">Income</option>
              <option value="expense">Expense</option>
            </select>
            <select className="rounded-md border border-slate-300 px-3 py-2 text-sm" defaultValue="active" aria-label="Status filter">
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
            <select className="rounded-md border border-slate-300 px-3 py-2 text-sm" defaultValue="compact" aria-label="Density">
              <option value="compact">Density: Compact</option>
              <option value="comfortable">Density: Comfortable</option>
            </select>
          </div>
        </section>

        <section className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-slate-100 text-slate-700">
              <tr>
                <th className="px-4 py-3">Code</th>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Currency</th>
                <th className="px-4 py-3">Balance</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {accounts.map((account) => (
                <tr key={account.code} className="border-t border-slate-200">
                  <td className="px-4 py-3 font-mono text-slate-900">{account.code}</td>
                  <td className="px-4 py-3 text-slate-800">{account.name}</td>
                  <td className="px-4 py-3 capitalize text-slate-700">{account.type}</td>
                  <td className="px-4 py-3 text-slate-700">{account.currency}</td>
                  <td className="px-4 py-3 text-slate-900">Rs {account.balanceDisplay}</td>
                  <td className="px-4 py-3">
                    <span className="rounded-full bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-700">{account.status}</span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-2">
                      <button className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-700 hover:bg-slate-100">View</button>
                      <button className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-700 hover:bg-slate-100">Edit</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </section>
    </main>
  );
}
