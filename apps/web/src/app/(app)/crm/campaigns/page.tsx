import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { Card, PageHeader, StatCard, StatGrid } from "../../../_components/ds";
import { getCrmCampaignRoiSummary } from "../../../_data/loaders";
import { formatMoney } from "@/lib/formatters";
import { CampaignRoiTable } from "./CampaignRoiTable";
import { formatRoiPercent, portfolioTotals, rankByNet } from "./campaigns";

export const dynamic = "force-dynamic";

export default async function CampaignsPage() {
  const { data: campaigns, source } = await getCrmCampaignRoiSummary();
  const totals = portfolioTotals(campaigns);
  const ranked = rankByNet(campaigns);

  // The service returns basis points; the display helper expects the already
  // divided percent string the per-campaign rows carry, so scale it the same way.
  const portfolioRoiPercent =
    totals.roiBasisPoints === null
      ? null
      : (Number(totals.roiBasisPoints) / 100).toFixed(2);

  return (
    <>
      <PageHeader
        title="Campaign Performance"
        subtitle="Spend, revenue and return for every campaign with recorded performance."
        back="/crm"
        backLabel="CRM"
      />
      {source === "error" && <DataSourceBadge source={source} />}
      <StatGrid>
        <StatCard icon="📣" iconBg="#e0f2fe" label="Campaigns Tracked" value={totals.campaigns.toLocaleString("en-IN")} />
        <StatCard icon="💸" iconBg="#fee2e2" label="Total Spend" value={formatMoney(totals.costMinor)} />
        <StatCard icon="💰" iconBg="#dcfce7" label="Attributed Revenue" value={formatMoney(totals.revenueMinor)} />
        <StatCard icon="📈" iconBg="#fef3c7" label="Portfolio ROI" value={formatRoiPercent(portfolioRoiPercent)} />
      </StatGrid>

      <Card title="Campaigns by Net Contribution">
        <CampaignRoiTable rows={ranked} />
      </Card>
    </>
  );
}
