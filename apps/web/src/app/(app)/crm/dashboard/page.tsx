import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { PageHeader, StatCard, StatGrid, Card } from "../../../_components/ds";
import { getCRMDashboard } from "../../../_data/loaders";
import { formatMoney } from "@/lib/formatters";
import Link from "next/link";

export default async function Page() {
  const { data: dash, source } = await getCRMDashboard();

  return (
    <>
      <PageHeader
        title="CRM"
        subtitle="Modern sales CRM: leads, deals and pipeline."
        actions={
          <>
            <a className="btn ghost" href="/crm/contacts/new">+ New Contact</a>
            <a className="btn primary" href="/crm/deals/new">+ New Deal</a>
          </>
        }
      />
      {source === "error" && <DataSourceBadge source={source} />}
      <StatGrid>
        <StatCard icon="🎯" iconBg="#fce7ee" label="Leads / Contacts" value={dash.totalContacts.toLocaleString("en-IN")} />
        <StatCard icon="🎯" iconBg="#fce7ee" label="Deals Open" value={dash.openDeals.toLocaleString("en-IN")} />
        <StatCard icon="🎯" iconBg="#fce7ee" label="Activities Today" value={dash.activitiesToday.toLocaleString("en-IN")} />
        <StatCard icon="🎯" iconBg="#fce7ee" label="Pipeline Value" value={formatMoney(dash.pipelineValue)} />
      </StatGrid>
      <Card title="Quick links">
        <div style={{ display: "flex", gap: "12px", padding: "12px 16px", flexWrap: "wrap" }}>
          <Link href="/crm/contacts" className="btn ghost"><span aria-hidden="true">📋</span> Contacts</Link>
          <Link href="/crm/deals" className="btn ghost"><span aria-hidden="true">🤝</span> Deal Pipeline</Link>
          <Link href="/crm/activities" className="btn ghost"><span aria-hidden="true">⚡</span> Activities</Link>
        </div>
      </Card>
    </>
  );
}
