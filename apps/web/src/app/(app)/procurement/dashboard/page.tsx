import Link from "next/link";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { PageShell } from "../../../_components/PageShell";
import { getProcurementDashboard } from "../../../_data/loaders";

const quickLinks = [
  { title: "Purchase Indents", href: "/procurement/indents" },
  { title: "Vendors", href: "/procurement/vendors" },
  { title: "RFQ", href: "/procurement/rfq" },
  { title: "Purchase Orders", href: "/procurement/orders" },
  { title: "Goods Receipt", href: "/procurement/grn" },
  { title: "Contracts", href: "/procurement/contracts" },
  { title: "Tenders", href: "/procurement/tenders" },
  { title: "Approvals", href: "/procurement/approvals" },
];

export default async function Page() {
  const { data: dashboard, source } = await getProcurementDashboard();

  return (
    <PageShell title="Procurement Dashboard" description="Real-time snapshot of procurement activity and pending actions.">
      {source === "error" ? <DataSourceBadge source={source} /> : null}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Pending Indents</p>
          <p className="mt-2 text-3xl font-bold text-slate-900">{dashboard.pendingIndents}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Active POs</p>
          <p className="mt-2 text-3xl font-bold text-slate-900">{dashboard.activePOs}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">GRNs This Month</p>
          <p className="mt-2 text-3xl font-bold text-slate-900">{dashboard.grnsThisMonth}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Contract Renewals Due</p>
          <p className="mt-2 text-3xl font-bold text-amber-600">{dashboard.contractRenewalsDue}</p>
        </div>
      </div>

      <section className="mt-6">
        <h2 className="mb-3 text-sm font-semibold text-slate-700">Quick Access</h2>
        <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-4">
          {quickLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="rounded-xl border border-slate-200 bg-white p-4 text-sm font-medium text-slate-800 shadow-sm transition hover:border-indigo-300 hover:text-indigo-700"
            >
              {link.title}
            </Link>
          ))}
        </div>
      </section>
    </PageShell>
  );
}
