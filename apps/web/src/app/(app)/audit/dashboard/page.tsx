import Link from "next/link";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { getAuditDashboard } from "../../../_data/loaders";

export default async function AuditDashboardPage() {
  const { data, source } = await getAuditDashboard();

  return (
    <main className="min-h-screen bg-slate-50 p-6 md:p-8">
      <section className="mx-auto max-w-7xl space-y-5">
        <nav aria-label="Breadcrumb" className="text-sm text-slate-600">
          <Link href="/audit" className="hover:text-slate-900">Audit</Link>
          <span className="mx-2">/</span>
          <span className="text-slate-900">Dashboard</span>
        </nav>

        <header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-3xl font-semibold text-slate-900">Audit & Compliance Dashboard</h1>
            <p className="mt-1 text-sm text-slate-600">Overview of audit observations, risk register, and compliance status.</p>
          </div>
          {source === "error" ? <DataSourceBadge source={source} /> : null}
        </header>

        <section className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Open Observations</p>
            <p className="mt-1 text-2xl font-bold text-red-600">{data.openObservations}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Risk Register Items</p>
            <p className="mt-1 text-2xl font-bold text-orange-600">{data.riskRegisterItems}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">CAG Paras</p>
            <p className="mt-1 text-2xl font-bold text-purple-600">{data.cagParas}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Compliance %</p>
            <p className="mt-1 text-2xl font-bold text-green-600">{data.compliancePct.toFixed(1)}%</p>
          </div>
        </section>

        <section className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
          {[
            { label: "Observations", href: "/audit/observations" },
            { label: "Risk Register", href: "/audit/risk-register" },
            { label: "Audit Plan", href: "/audit/plan" },
            { label: "Compliance Tracking", href: "/audit/compliance" },
            { label: "Event Log", href: "/audit" },
            { label: "Export Jobs", href: "/audit/exports" },
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
