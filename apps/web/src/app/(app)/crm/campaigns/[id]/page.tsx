import { Card, DataTable, EmptyState, LoadErrorState, PageHeader, StatCard, StatGrid } from "../../../../_components/ds";
import { getCrmCampaignRoi } from "../../../../_data/loaders";
import { getTranslations } from "next-intl/server";
import { formatMoneyIn } from "@/lib/formatters";
import { formatRoiPercent, orderPeriods, periodLabel } from "../campaigns";

export const dynamic = "force-dynamic";

type PeriodRow = {
  id: string;
  period: string;
  cost: string;
  revenue: string;
  net: string;
  responses: number;
  roi: string;
};

/** First segment of a UUID, so the subtitle shows a recognisable short id rather than a 36-char string. */
function shortId(id: string): string {
  return id.includes("-") ? id.split("-")[0] : id.slice(0, 8);
}

export default async function CampaignRoiPage({ params }: { params: { id: string } }) {
  const t = await getTranslations("crmCampaignDetail");
  const { data: campaign, source, status, errorMessage } = await getCrmCampaignRoi(params.id);

  // GAP-CRM-CAMPAIGNS-DETAIL-02: a true "no figures" 404 and an outage both
  // produced the same EmptyState. Separate them: a 404 is the expected
  // "nobody has costed this campaign yet" state; any other failure gets the
  // shared retry/permission-aware error state instead of masking the outage.
  if (!campaign) {
    if (source === "error" && status !== 404) {
      return (
        <>
          <PageHeader title={t("performanceTitle")} back="/crm/campaigns" backLabel={t("backLabel")} />
          <LoadErrorState
            result={{ status, errorMessage }}
            area={t("loadArea")}
            backHref="/crm/campaigns"
            backLabel={t("backLabel")}
          />
        </>
      );
    }
    return (
      <>
        <PageHeader title={t("performanceTitle")} back="/crm/campaigns" backLabel="Campaigns" />
        <EmptyState
          icon="📣"
          title="No performance recorded"
          message="This campaign has no cost, revenue or response figures posted against it yet."
        />
      </>
    );
  }

  const currency = campaign.currency;
  const rows: PeriodRow[] = orderPeriods(campaign.periods).map((period, index) => ({
    id: `${period.periodStart ?? "unscheduled"}-${index}`,
    period: periodLabel(period),
    cost: formatMoneyIn(period.costMinor, currency),
    revenue: formatMoneyIn(period.revenueMinor, currency),
    net: formatMoneyIn(period.netMinor, currency),
    responses: period.responses,
    roi: formatRoiPercent(period.roiPercent),
  }));

  // GAP-CRM-CAMPAIGNS-DETAIL-01: the backend's campaign_performance rows carry
  // no campaign name (only a campaign_id), so until a name is joined the title
  // falls back to "Campaign" and the full id moves to the subtitle as a short id.
  const title = campaign.name ?? t("fallbackTitle");
  const subtitle = t("subtitleNamed", { id: shortId(campaign.campaignId), currency });

  return (
    <>
      <PageHeader title={title} subtitle={subtitle} back="/crm/campaigns" backLabel="Campaigns" />
      <StatGrid>
        {/* GAP-CRM-CAMPAIGNS-DETAIL-03: format in the campaign's own currency, not always ₹. */}
        <StatCard icon="💸" iconBg="#fee2e2" label="Spend" value={formatMoneyIn(campaign.costMinor, currency)} />
        <StatCard icon="💰" iconBg="#dcfce7" label="Revenue" value={formatMoneyIn(campaign.revenueMinor, currency)} />
        <StatCard icon="🧮" iconBg="#e0f2fe" label="Net" value={formatMoneyIn(campaign.netMinor, currency)} />
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
              {campaign.costPerResponseMinor ? formatMoneyIn(campaign.costPerResponseMinor, currency) : "—"}
            </div>
          </div>
          <div className="fld">
            <div className="l">Reporting periods</div>
            <div className="v">{campaign.periods.length}</div>
          </div>
          <div className="fld">
            <div className="l">{t("campaignId")}</div>
            <div className="v" style={{ fontSize: 12, fontFamily: "monospace" }}>{campaign.campaignId}</div>
          </div>
        </div>
      </Card>

      <Card title="Period Breakdown">
        <DataTable<PeriodRow>
          columns={[
            { key: "period", label: "Period" },
            { key: "cost", label: "Spend", align: "right" },
            { key: "revenue", label: "Revenue", align: "right" },
            { key: "net", label: "Net", align: "right" },
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
