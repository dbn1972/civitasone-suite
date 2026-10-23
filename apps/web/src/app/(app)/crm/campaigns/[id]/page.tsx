import type { Metadata } from "next";
import { Card, DataTable, EmptyState, LoadErrorState, PageHeader, StatCard, StatGrid } from "../../../../_components/ds";
import { getCrmCampaignRoi } from "../../../../_data/loaders";
import { getTranslations } from "next-intl/server";
import { formatMoneyIn } from "@/lib/formatters";
import { getSessionRoles, hasAnyRole, CRM_CAMPAIGN_PERFORMANCE_POST_ROLES } from "@/lib/auth/roleGuard";
import { formatRoiPercent, orderPeriods, periodLabel } from "../campaigns";
import { PostPeriodForm } from "./PostPeriodForm";
import { CopyIdButton } from "./CopyIdButton";

export const dynamic = "force-dynamic";

/**
 * GAP-CRM-CAMPAIGNS-DETAIL-01: the browser tab names the campaign (its name when the
 * service has one, otherwise the neutral "Campaign"), never the raw id.
 */
export async function generateMetadata(props: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const params = await props.params;
  const t = await getTranslations("crmCampaignDetail");
  const { data: campaign } = await getCrmCampaignRoi(params.id);
  return { title: `${campaign?.name ?? t("fallbackTitle")} — CivitasOne CRM` };
}

type PeriodRow = {
  id: string;
  period: string;
  cost: string;
  revenue: string;
  net: string;
  responses: number;
  roi: string;
};

/** crm-service campaign ids are UUIDs; the 404 branch only has the (user-controlled) URL segment to go on. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** First segment of a UUID, so the subtitle shows a recognisable short id rather than a 36-char string. */
function shortId(id: string): string {
  return id.includes("-") ? id.split("-")[0] : id.slice(0, 8);
}

export default async function CampaignRoiPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const t = await getTranslations("crmCampaignDetail");
  const { data: campaign, source, status, errorMessage } = await getCrmCampaignRoi(params.id);
  // The write behind the "post a reporting period" form is admin-gated in
  // crm-service; only offer the form to the roles it admits, so nobody fills
  // it in just to hit a 403. The server remains the authority.
  const canPostPeriod = hasAnyRole(getSessionRoles(), CRM_CAMPAIGN_PERFORMANCE_POST_ROLES);

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
    // The id on this branch is the raw URL segment (no server payload vouches for
    // it), so the form is rendered only for a UUID-shaped id as well as an admin.
    const showPostForm = canPostPeriod && UUID_RE.test(params.id);
    return (
      <>
        <PageHeader title={t("performanceTitle")} back="/crm/campaigns" backLabel={t("backLabel")} />
        <EmptyState
          icon="📣"
          title={t("noPerformanceTitle")}
          message={showPostForm ? t("noPerformanceMessage") : t("noPerformanceMessageReadOnly")}
        />
        {/* GAP-CRM-CAMPAIGNS-DETAIL-04: a campaign with no periods answers 404, so
            the form must live on this branch too or its first period could never
            be posted. The currency is not known yet, so it defaults to the
            service default (INR) and is editable for this first period. */}
        {showPostForm ? <PostPeriodForm campaignId={params.id} currency="INR" currencyEditable /> : null}
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

  // GAP-CRM-CAMPAIGNS-DETAIL-01: the title is the campaign's name when the service
  // has one (sent on the performance feed / the Post-period form below); a
  // campaign never named falls back to "Campaign" with a SHORT id in the subtitle.
  const title = campaign.name ?? t("fallbackTitle");
  const subtitle = t("subtitleNamed", { id: shortId(campaign.campaignId), currency });

  return (
    <>
      <PageHeader title={title} subtitle={subtitle} back="/crm/campaigns" backLabel="Campaigns" />
      <StatGrid>
        {/* GAP-CRM-CAMPAIGNS-DETAIL-03: format in the campaign's own currency, not always ₹. */}
        <StatCard icon="💸" tone="bad" label="Spend" value={formatMoneyIn(campaign.costMinor, currency)} />
        <StatCard icon="💰" tone="good" label="Revenue" value={formatMoneyIn(campaign.revenueMinor, currency)} />
        <StatCard icon="🧮" tone="info" label="Net" value={formatMoneyIn(campaign.netMinor, currency)} />
        <StatCard icon="📈" tone="warn" label="ROI" value={formatRoiPercent(campaign.roiPercent)} />
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
            {/* Short id on screen; the copy button hands over the full one. */}
            <div className="v" style={{ fontSize: 12, fontFamily: "monospace" }} title={campaign.campaignId}>
              {shortId(campaign.campaignId)} <CopyIdButton value={campaign.campaignId} />
            </div>
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
          exportable exportAudit="crm/campaigns/id"
          exportFilename={`crm-campaign-${campaign.campaignId}-roi`}
          exportNotice="Exports leave the system; handle spend and revenue figures per policy."
          emptyIcon="🗓️"
          emptyTitle={t("noPeriodsTitle")}
          emptyMessage={t("noPeriodsMessage")}
        />
      </Card>

      {/* GAP-CRM-CAMPAIGNS-DETAIL-04: the empty-state instruction to "post a
          reporting period's cost and revenue" is now actionable from here, for
          the admin roles the write is gated to (crm-service enforces the same). */}
      {canPostPeriod ? (
        <PostPeriodForm
          campaignId={campaign.campaignId}
          currency={currency}
          {...(campaign.name ? { campaignName: campaign.name } : {})}
        />
      ) : null}
    </>
  );
}
