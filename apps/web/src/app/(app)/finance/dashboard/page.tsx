import Link from "next/link";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { getFinanceDashboard } from "../../../_data/loaders";

export default async function FinanceDashboardPage() {
  const { data, source } = await getFinanceDashboard();

  return (
    <main className="min-h-screen bg-slate-50 p-6 md:p-8">
      <section className="mx-auto max-w-7xl space-y-5">
        <nav aria-label="Breadcrumb" className="text-sm text-slate-600">
          <Link href="/finance" className="hover:text-slate-900">Finance</Link>
          <span className="mx-2">/</span>
          <span className="text-slate-900">Dashboard</span>
        </nav>

        <header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-3xl font-semibold text-slate-900">Finance Dashboard</h1>
            <p className="mt-1 text-sm text-slate-600">Key finance KPIs and quick navigation.</p>
          </div>
          {source === "error" ? <DataSourceBadge source={source} /> : null}
        </header>

        <section className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Budget Utilisation</p>
            <p className="mt-1 text-2xl font-bold text-blue-600">{data.budgetUtilisationPct.toFixed(1)}%</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Pending Sanctions</p>
            <p className="mt-1 text-2xl font-bold text-yellow-600">{data.pendingSanctions}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Payments This Month</p>
            <p className="mt-1 text-2xl font-bold text-green-600">₹{(data.paymentsThisMonth / 100).toLocaleString("en-IN")}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Total Expenditure</p>
            <p className="mt-1 text-2xl font-bold text-slate-900">₹{(data.totalExpenditure / 100).toLocaleString("en-IN")}</p>
          </div>
        </section>

        <section className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
          {[
            { label: "Budget Formulation", href: "/finance/budget/formulation" },
            { label: "Sanctions", href: "/finance/budget/sanctions" },
            { label: "Bill Processing", href: "/finance/expenditure/bills" },
            { label: "Advances", href: "/finance/expenditure/advances" },
            { label: "Utilization Certificates", href: "/finance/expenditure/utilization-certificates" },
            { label: "General Ledger", href: "/finance/accounting/general-ledger" },
            { label: "New Voucher", href: "/finance/accounting/vouchers/new" },
            { label: "Financial Statements", href: "/finance/accounting/financial-statements" },
            { label: "Chart of Accounts", href: "/finance/chart-of-accounts" },
            { label: "Payments", href: "/finance/payments" },
          ].map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md text-sm font-medium text-slate-800"
            >
              {link.label}
            </Link>
          ))}
        </section>
      </section>
    </main>
  );
}
