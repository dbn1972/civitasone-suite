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
        back="/crm"
        backLabel="CRM Hub"
        actions={
          <>
            <a className="btn ghost" href="/crm/contacts/new">+ New Contact</a>
            <a className="btn primary" href="/crm/deals/new">+ New Engagement</a>
          </>
        }
      />
      {source === "error" && <DataSourceBadge source={source} />}
      <StatGrid>
        <StatCard icon="👤" iconBg="#eef2ff" label="Contacts / Stakeholders" value={dash.totalContacts.toLocaleString("en-IN")} />
        <StatCard icon="🔄" iconBg="#ecfdf3" label="Active Engagements" value={dash.openDeals.toLocaleString("en-IN")} />
        <StatCard icon="⚡" iconBg="#fffaeb" label="Interactions Today" value={dash.activitiesToday.toLocaleString("en-IN")} />
        <StatCard icon="📊" iconBg="#f3e8ff" label="Pipeline Value" value={formatMoney(dash.pipelineValue)} />
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
        className="flex items-start gap-2.5 mt-4 px-4 py-3 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-800"
      >
        <span aria-hidden="true" className="text-base leading-snug">ℹ️</span>
        <span>
          This module tracks vendor interactions, stakeholder engagements, and beneficiary contacts —
          not a commercial sales pipeline.
        </span>
      </div>
    </>
  );
}
