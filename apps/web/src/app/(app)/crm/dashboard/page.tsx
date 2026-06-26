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
        subtitle="Government stakeholder and vendor interaction register."
        actions={
          <>
            <a className="btn ghost" href="/crm/contacts/new">+ New Contact</a>
            <a className="btn primary" href="/crm/deals/new">+ New Engagement</a>
          </>
        }
      />
      {source === "error" && <DataSourceBadge source={source} />}
      <StatGrid>
        <StatCard icon="👤" iconBg="#fce7ee" label="Contacts / Stakeholders" value={dash.totalContacts.toLocaleString("en-IN")} />
        <StatCard icon="🔄" iconBg="#fce7ee" label="Active Engagements" value={dash.openDeals.toLocaleString("en-IN")} />
        <StatCard icon="⚡" iconBg="#fce7ee" label="Interactions Today" value={dash.activitiesToday.toLocaleString("en-IN")} />
        <StatCard icon="📊" iconBg="#fce7ee" label="Pipeline Value" value={formatMoney(dash.pipelineValue)} />
      </StatGrid>
      <Card title="Quick links">
        <div style={{ display: "flex", gap: "12px", padding: "12px 16px", flexWrap: "wrap" }}>
          <Link href="/crm/contacts" className="btn ghost"><span aria-hidden="true">📋</span> Contacts</Link>
          <Link href="/crm/deals" className="btn ghost"><span aria-hidden="true">🤝</span> Engagements</Link>
          <Link href="/crm/activities" className="btn ghost"><span aria-hidden="true">⚡</span> Activities</Link>
        </div>
      </Card>
      <div
        role="note"
        aria-label="Module purpose notice"
        style={{
          display: "flex",
          alignItems: "flex-start",
          gap: 10,
          marginTop: 16,
          padding: "12px 16px",
          background: "#eff6ff",
          border: "1px solid #bfdbfe",
          borderRadius: 8,
          fontSize: 13,
          color: "#1e40af",
        }}
      >
        <span aria-hidden="true" style={{ fontSize: 16, lineHeight: 1.4 }}>ℹ️</span>
        <span>
          This module tracks vendor interactions, stakeholder engagements, and beneficiary contacts —
          not a commercial sales pipeline.
        </span>
      </div>
    </>
  );
}
