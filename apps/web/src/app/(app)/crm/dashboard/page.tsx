import Link from "next/link";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { PageShell } from "../../../_components/PageShell";
import { getCRMDashboard } from "../../../_data/loaders";

function fmt(n: number): string {
  return n.toLocaleString("en-IN");
}

function fmtCrore(paise: number): string {
  const crore = paise / 10_000_000;
  return crore >= 1 ? `₹${crore.toFixed(2)} Cr` : `₹${(paise / 100).toLocaleString("en-IN")}`;
}

export default async function Page() {
  const { data: dash, source } = await getCRMDashboard();

  const stats = [
    { label: "Total Contacts", value: fmt(dash.totalContacts) },
    { label: "Open Deals", value: fmt(dash.openDeals) },
    { label: "Activities Due Today", value: fmt(dash.activitiesToday) },
    { label: "Pipeline Value", value: fmtCrore(dash.pipelineValue) },
  ];

  const links: Array<{ label: string; href: string; desc: string }> = [
    { label: "Contacts", href: "/crm/contacts", desc: "View and manage contacts" },
    { label: "Deal Pipeline", href: "/crm/deals", desc: "Track open and closed deals" },
    { label: "Activities", href: "/crm/activities", desc: "Calls, meetings, tasks" },
  ];

  return (
    <PageShell
      title="CRM Dashboard"
      description="High-level pipeline and activity snapshot."
      breadcrumb={
        <span className="text-slate-900">CRM</span>
      }
    >
      {source === "error" ? <DataSourceBadge source={source} /> : null}

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {stats.map((s) => (
          <div key={s.label} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-xs text-slate-500">{s.label}</p>
            <p className="mt-1 text-2xl font-semibold text-slate-900">{s.value}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        {links.map((l) => (
          <Link
            key={l.href}
            href={l.href}
            className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-indigo-300 hover:shadow-md"
          >
            <p className="font-semibold text-slate-900">{l.label}</p>
            <p className="mt-1 text-sm text-slate-500">{l.desc}</p>
          </Link>
        ))}
      </div>
    </PageShell>
  );
}
