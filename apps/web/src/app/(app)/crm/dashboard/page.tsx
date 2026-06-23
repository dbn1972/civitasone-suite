import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { PageHeader, StatCard, StatGrid, Card } from "../../../_components/ds";
import { getCRMDashboard } from "../../../_data/loaders";
import Link from "next/link";

function fmtCrore(paise: number): string {
  const crore = paise / 10_000_000;
  return crore >= 1 ? `₹${crore.toFixed(1)} Cr` : `₹${(paise / 100).toLocaleString("en-IN")}`;
}

export default async function Page() {
  const { data: dash, source } = await getCRMDashboard();

  return (
    <>
      <PageHeader
        title="🎯 CRM"
        subtitle="Modern sales CRM: leads, deals and pipeline."
        actions={
          <>
            <button className="btn ghost">Export</button>
            <button className="btn primary">+ New</button>
          </>
        }
      />
      {source === "error" && <DataSourceBadge source={source} />}
      <StatGrid>
        <StatCard icon="🎯" iconBg="#fce7ee" label="Leads / Contacts" value={dash.totalContacts.toLocaleString("en-IN")} delta="+90" up />
        <StatCard icon="🎯" iconBg="#fce7ee" label="Deals Open" value={dash.openDeals.toLocaleString("en-IN")} delta="+22" up />
        <StatCard icon="🎯" iconBg="#fce7ee" label="Activities Today" value={dash.activitiesToday.toLocaleString("en-IN")} />
        <StatCard icon="🎯" iconBg="#fce7ee" label="Pipeline Value" value={fmtCrore(dash.pipelineValue)} delta="+13%" up />
      </StatGrid>
      <Card title="Quick links">
        <div style={{ display: "flex", gap: "12px", padding: "12px 16px", flexWrap: "wrap" }}>
          <Link href="/crm/contacts" className="btn ghost">📋 Contacts</Link>
          <Link href="/crm/deals" className="btn ghost">🤝 Deal Pipeline</Link>
          <Link href="/crm/activities" className="btn ghost">⚡ Activities</Link>
        </div>
      </Card>
    </>
  );
}
