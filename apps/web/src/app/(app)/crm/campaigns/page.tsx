import { Card, LoadErrorState, PageHeader, StatCard, StatGrid } from "../../../_components/ds";
import { getCrmCampaignRoiSummary } from "../../../_data/loaders";
import { getTranslations } from "next-intl/server";
import { formatMoney } from "@/lib/formatters";
import { CampaignRoiTable } from "./CampaignRoiTable";
import { formatRoiPercent, portfolioTotals, rankByNet } from "./campaigns";

export const dynamic = "force-dynamic";

export default async function CampaignsPage() {
  const t = await getTranslations("crmCampaignsPage");
  const { data, source, status, errorMessage } = await getCrmCampaignRoiSummary();

  // GAP-CRM-CAMPAIGNS-02: a failed load must not read as "nothing spent". The
  // old page folded an empty list to 0 / ₹0.00 and the table said "No campaign
  // spend recorded", indistinguishable from a true empty portfolio. On error we
  // now show the shared retry/permission-aware state instead of fabricated zeros.
  if (source === "error") {
    return (
      <>
        <PageHeader
          title={t("title")}
          subtitle={t("subtitle")}
          back="/crm"
          backLabel={t("backLabel")}
        />
        <LoadErrorState
          result={{ status, errorMessage }}
          area={t("loadArea")}
          backHref="/crm"
          backLabel={t("backLabel")}
        />
      </>
    );
  }

  const campaigns = data.rows;
  const totals = portfolioTotals(campaigns);
  const ranked = rankByNet(campaigns);

  // GAP-CRM-CAMPAIGNS-03: the service page-limits roi-summary; when more
  // campaigns exist than were fetched the folded totals are only a partial view.
  const truncated = data.total > campaigns.length;

  // GAP-CRM-CAMPAIGNS-DETAIL-03 / 03: the summed Total Spend and Attributed
  // Revenue are only meaningful when every campaign shares one currency. If the
  // page carries a mix, a ₹ sum would be nonsense, so we show "—" for the money
  // totals and explain why rather than add rupees to dollars.
  const currencies = new Set(campaigns.map((c) => c.currency));
  const mixedCurrency = currencies.size > 1;
  const singleCurrency = currencies.size === 1 ? [...currencies][0] : null;

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
      {truncated && (
        <div
          role="status"
          aria-label={t("partialAria")}
          className="flex items-start gap-2.5 mb-4 px-4 py-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-900"
        >
          <span>
            {t("truncatedNotice", { shown: campaigns.length.toLocaleString("en-IN"), total: data.total.toLocaleString("en-IN") })}
          </span>
        </div>
      )}
      {mixedCurrency && (
        <div
          role="status"
          aria-label={t("mixedAria")}
          className="flex items-start gap-2.5 mb-4 px-4 py-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-900"
        >
          <span>
            {t("mixedNotice", { currencies: [...currencies].join(", ") })}
          </span>
        </div>
      )}
      <StatGrid>
        <StatCard icon="📣" iconBg="#e0f2fe" label="Campaigns Tracked" value={totals.campaigns.toLocaleString("en-IN")} />
        <StatCard
          icon="💸"
          iconBg="#fee2e2"
          label="Total Spend"
          value={mixedCurrency ? "—" : formatMoney(totals.costMinor)}
        />
        <StatCard
          icon="💰"
          iconBg="#dcfce7"
          label="Attributed Revenue"
          value={mixedCurrency ? "—" : formatMoney(totals.revenueMinor)}
        />
        <StatCard icon="📈" iconBg="#fef3c7" label="Portfolio ROI" value={formatRoiPercent(portfolioRoiPercent)} />
      </StatGrid>

      {totals.unmeasuredCampaigns > 0 && !mixedCurrency && (
        <p role="note" style={{ fontSize: 13, color: "var(--muted)", margin: "4px 0 12px" }}>
          {t("unmeasuredNote", {
            n: totals.unmeasuredCampaigns,
            countText: totals.unmeasuredCampaigns.toLocaleString("en-IN"),
            amount: formatMoney(totals.unmeasuredRevenueMinor),
            currencySuffix: singleCurrency && singleCurrency !== "INR" ? ` ${singleCurrency}` : "",
          })}
        </p>
      )}

      <Card title="Campaigns by Net Contribution">
        <CampaignRoiTable rows={ranked} />
      </Card>
    </>
  );
}
