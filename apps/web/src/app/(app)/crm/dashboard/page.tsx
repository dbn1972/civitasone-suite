import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { PageHeader, StatCard, StatGrid, Card } from "../../../_components/ds";
import { getCRMDashboard } from "../../../_data/loaders";
import { formatMoney } from "@/lib/formatters";
import Link from "next/link";
import { getTranslations } from "next-intl/server";

export default async function Page() {
  const t = await getTranslations("crmDashboardPage");
  const { data: dash, source } = await getCRMDashboard();

  // GAP-CRM-DASHBOARD-01: a failed load must not read as "no contacts, no
  // engagements". Show "—" (the same convention Contacts/Accounts/Activities
  // use) instead of a fabricated 0 / ₹0.00 beside the "couldn't load" badge.
  const stat = (n: number) => (source === "error" ? "—" : n.toLocaleString("en-IN"));
  const money = source === "error" ? "—" : formatMoney(dash.pipelineValue);

  return (
    <>
      <PageHeader
        title="CRM"
        subtitle="Government stakeholder and vendor interaction register • सरकारी हितधारक पंजी"
        back="/crm"
        backLabel="CRM Hub"
        help="crm/overview"
        actions={
          <>
            <a className="btn ghost" href="/crm/contacts/new">+ New Contact</a>
            <a className="btn primary" href="/crm/deals/new">+ New Engagement</a>
          </>
        }
      />
      {source === "error" && <DataSourceBadge source={source} />}
      <StatGrid>
        <StatCard icon="▣" iconBg="#eef2ff" label="Contacts / Stakeholders" value={stat(dash.totalContacts)} />
        <StatCard icon="◉" iconBg="#ecfdf3" label="Active Engagements" value={stat(dash.openDeals)} />
        <StatCard icon="◈" iconBg="#fffaeb" label="Interactions Today" value={stat(dash.activitiesToday)} />
        <StatCard icon="△" iconBg="#f3e8ff" label="Active Engagement Value" value={money} />
      </StatGrid>
      <Card title="Quick links">
        <div style={{ display: "flex", gap: "12px", padding: "12px 16px", flexWrap: "wrap" }}>
          <Link href="/crm/contacts" className="btn ghost">Contacts</Link>
          <Link href="/crm/deals" className="btn ghost">Engagements</Link>
          <Link href="/crm/activities" className="btn ghost">Activities</Link>
        </div>
      </Card>
      <div
        role="note"
        aria-label="Module purpose notice"
        className="flex items-start gap-2.5 mt-4 px-4 py-3 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-800"
      >
        <span>
          {t("moduleNote")}
        </span>
      </div>
    </>
  );
}
