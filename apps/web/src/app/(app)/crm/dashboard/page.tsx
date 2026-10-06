import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { PageHeader, StatCard, StatGrid, Card } from "../../../_components/ds";
import { getCRMDashboard } from "../../../_data/loaders";
import { formatMoney } from "@/lib/formatters";
import { getTranslations } from "next-intl/server";
import Link from "next/link";

export default async function Page() {
  const t = await getTranslations("crmDashboardPage");
  const { data: dash, source } = await getCRMDashboard();
  // GAP-CRM-DASHBOARD-06: title/subtitle come from next-intl (crm.dashboard.*)
  // instead of a hard-coded English+Devanagari literal, so the active locale's
  // string is rendered (en/hi today; ta/te/kn fall back to English per
  // restored-locales policy). GAP-CRM-DASHBOARD-03: the title is now the same
  // "CRM Dashboard" string the loading skeleton shows, so the h1 no longer
  // flips on paint.
  const tl = await getTranslations("crm.dashboard");

  // GAP-CRM-DASHBOARD-01: a failed load must not read as "no contacts, no
  // engagements". Show "—" (the same convention Contacts/Accounts/Activities
  // use) instead of a fabricated 0 / ₹0.00 beside the "couldn't load" badge.
  const stat = (n: number) => (source === "error" ? "—" : n.toLocaleString("en-IN"));
  const money = source === "error" ? "—" : formatMoney(dash.pipelineValue);

  return (
    <>
      <PageHeader
        title={tl("title")}
        subtitle={tl("subtitle")}
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
        {/* GAP-CRM-DASHBOARD-04: stat cards drill into their lists. Interactions
            Today opens the activities "Today" segment the table already supports. */}
        <StatCard icon="▣" iconBg="#eef2ff" label="Contacts / Stakeholders" value={stat(dash.totalContacts)} href="/crm/contacts" />
        <StatCard icon="◉" iconBg="#ecfdf3" label="Active Engagements" value={stat(dash.openDeals)} href="/crm/deals" />
        <StatCard icon="◈" iconBg="#fffaeb" label="Interactions Today" value={stat(dash.activitiesToday)} href="/crm/activities?segment=Today" />
        <StatCard icon="△" iconBg="#f3e8ff" label="Active Engagement Value" value={money} href="/crm/deals" />
      </StatGrid>
      <Card title="Quick links">
        <div style={{ display: "flex", gap: "12px", padding: "12px 16px", flexWrap: "wrap" }}>
          {/* GAP-CRM-DASHBOARD-05: the engagements link uses the same
              "Engagements" noun as the CRM hub tile (both -> /crm/deals), not
              "Deals". Extended with Accounts and the Pipeline Board so the quick
              links are more than a three-item subset. */}
          <Link href="/crm/contacts" className="btn ghost">Contacts</Link>
          <Link href="/crm/accounts" className="btn ghost">Accounts</Link>
          <Link href="/crm/deals" className="btn ghost">Engagements</Link>
          <Link href="/crm/pipeline" className="btn ghost">Pipeline Board</Link>
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
