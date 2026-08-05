import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { Card, DataTable, EmptyState, PageHeader, StatCard, StatGrid } from "../../../../_components/ds";
import { getCrmCampaignRoi } from "../../../../_data/loaders";
import { formatMoney } from "@/lib/formatters";
import { formatRoiPercent, orderPeriods, periodLabel } from "../campaigns";

export const dynamic = "force-dynamic";

type PeriodRow = {
  id: string;
  period: string;
  costMinor: string;
  revenueMinor: string;
  netMinor: string;
  responses: number;
  roi: string;
};

export default async function CampaignRoiPage({ params }: { params: { id: string } }) {
  const { data: campaign, source } = await getCrmCampaignRoi(params.id);

  if (!campaign) {
    return (
      <>
        <PageHeader title="Campaign Performance" back="/crm/campaigns" backLabel="Campaigns" />
        {source === "error" && <DataSourceBadge source={source} />}
        <EmptyState
          icon="📣"
          title="No performance recorded"
          message="This campaign has no cost, revenue or response figures posted against it yet."
        />
      </>
    );
  }

  const rows: PeriodRow[] = orderPeriods(campaign.periods).map((period, index) => ({
    id: `${period.periodStart ?? "unscheduled"}-${index}`,
    period: periodLabel(period),
    costMinor: period.costMinor,
    revenueMinor: period.revenueMinor,
    netMinor: period.netMinor,
    responses: period.responses,
    roi: formatRoiPercent(period.roiPercent),
  }));

  return (
    <>
      <PageHeader
        title="Campaign Performance"
        subtitle={`Campaign ${campaign.campaignId} · ${campaign.currency}`}
        back="/crm/campaigns"
        backLabel="Campaigns"
      />
      {source === "error" && <DataSourceBadge source={source} />}
      <StatGrid>
        <StatCard icon="💸" iconBg="#fee2e2" label="Spend" value={formatMoney(campaign.costMinor)} />
        <StatCard icon="💰" iconBg="#dcfce7" label="Revenue" value={formatMoney(campaign.revenueMinor)} />
        <StatCard icon="🧮" iconBg="#e0f2fe" label="Net" value={formatMoney(campaign.netMinor)} />
        <StatCard icon="📈" iconBg="#fef3c7" label="ROI" value={formatRoiPercent(campaign.roiPercent)} />
      </StatGrid>

      <Card title="Responses">
        <div className="fields">
          <div className="fld">
            <div className="l">Responses</div>
            <div className="v">{campaign.responses.toLocaleString("en-IN")}</div>
          </div>
          <div className="fld">
            <div className="l">Cost per response</div>
            <div className="v">
              {campaign.costPerResponseMinor ? formatMoney(campaign.costPerResponseMinor) : "—"}
            </div>
          </div>
          <div className="fld">
            <div className="l">Reporting periods</div>
            <div className="v">{campaign.periods.length}</div>
          </div>
        </div>
      </Card>

      <Card title="Period Breakdown">
        <DataTable<PeriodRow>
          columns={[
            { key: "period", label: "Period" },
            { key: "costMinor", label: "Spend", align: "right", cellType: "amount" },
            { key: "revenueMinor", label: "Revenue", align: "right", cellType: "amount" },
            { key: "netMinor", label: "Net", align: "right", cellType: "amount" },
            { key: "roi", label: "ROI", align: "right" },
            { key: "responses", label: "Responses", align: "right" },
          ]}
          rows={rows}
          sortable
          exportable
          exportFilename={`crm-campaign-${campaign.campaignId}-roi`}
          emptyIcon="🗓️"
          emptyTitle="No periods recorded"
          emptyMessage="Post a reporting period's cost and revenue to see the breakdown."
        />
      </Card>
    </>
  );
}
