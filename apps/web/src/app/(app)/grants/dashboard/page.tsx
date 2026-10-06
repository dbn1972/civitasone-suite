import { PageHeader, StatGrid, StatCard, Card, RefreshErrorState } from "@/app/_components/ds";
import { formatMoney, formatPercent } from "@/lib/formatters";
import { toHumanError } from "@/lib/messages";
import { getGrantsDashboard, getGrants } from "../../../_data/loaders";
import { DashboardGrantsTable } from "./DashboardGrantsTable";

export default async function GrantsDashboardPage() {
  const [dashResult, grantsResult] = await Promise.all([
    getGrantsDashboard(),
    getGrants(),
  ]);

  const { data } = dashResult;
  const grants = grantsResult.data;
  const anyError = dashResult.source === "error" || grantsResult.source === "error";

  const activeGrants = anyError ? null : grants.filter((g) => g.status === "active").length;
  // GAP-GRANTS-DASHBOARD-01: label the figure by its real basis (ALL sanctioned
  // grants, no fiscal-year field is available), and compute Disbursed from the
  // SAME grants rows the table shows so the two never disagree.
  const sanctionedTotal = anyError ? null : grants.reduce((s, g) => s + g.totalAmount, 0);
  const disbursedTotal = anyError ? null : grants.reduce((s, g) => s + g.disbursedAmount, 0);
  // GAP-GRANTS-DASHBOARD-02: a real utilisation measure (disbursed / sanctioned).
  const utilisationPct =
    anyError || sanctionedTotal === null || disbursedTotal === null || sanctionedTotal <= 0
      ? null
      : (disbursedTotal / sanctionedTotal) * 100;

  return (
    <>
      {/* GAP-GRANTS-DASHBOARD-04: back link to the hub. */}
      <PageHeader
        title="Grants Dashboard"
        subtitle="Grant lifecycle, releases, utilisation and audit — one view."
        back="/grants"
        backLabel="Grants"
      />
      <StatGrid>
        {/* GAP-GRANTS-DASHBOARD-04: Active Grants drills into the grants list. */}
        <StatCard
          icon="🎁"
          iconBg="#dcfce7"
          label="Active Grants"
          value={activeGrants === null ? "—" : activeGrants}
          href="/grants/list"
        />
        {/* GAP-GRANTS-DASHBOARD-01: honest label; no FY filter exists. */}
        <StatCard icon="💰" iconBg="#f1f5f9" label="Total Sanctioned" value={sanctionedTotal === null ? "—" : formatMoney(sanctionedTotal)} hint="Sum of sanctioned amounts across all grants" />
        <StatCard icon="📤" iconBg="#dbeafe" label="Disbursed" value={disbursedTotal === null ? "—" : formatMoney(disbursedTotal)} hint="Sum of the Disbursed column below" />
        {/* GAP-GRANTS-DASHBOARD-02: real utilisation KPI. */}
        <StatCard icon="📈" iconBg="#ede9fe" label="Utilisation" value={formatPercent(utilisationPct)} hint="Disbursed ÷ Sanctioned" />
      </StatGrid>
      {/* GAP-GRANTS-DASHBOARD-02: surface the fetched-but-unrendered figures,
          and link UC Pending to the UC tracking page (GAP-GRANTS-DASHBOARD-04). */}
      <StatGrid>
        <StatCard icon="🗂️" iconBg="#f1f5f9" label="Total Grants" value={anyError ? "—" : data.totalGrants} />
        <StatCard icon="👥" iconBg="#e0f2fe" label="Grantees" value={anyError ? "—" : data.totalGrantees} />
        <StatCard icon="📋" iconBg="#fef3c7" label="UC Pending" value={anyError ? "—" : data.pendingUCs} href="/grants/utilization" />
      </StatGrid>
      <Card title="Grants">
        {anyError ? (
          <RefreshErrorState error={toHumanError("load", { area: "grants" })} />
        ) : (
          <DashboardGrantsTable grants={grants} source={grantsResult.source} />
        )}
      </Card>
    </>
  );
}
