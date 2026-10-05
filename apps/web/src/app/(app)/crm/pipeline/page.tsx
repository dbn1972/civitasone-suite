import { getTranslations } from "next-intl/server";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { PageHeader, StatCard, StatGrid } from "../../../_components/ds";
import { getPipelines, getPipelineDeals, PIPELINE_DEAL_LIMIT } from "../../../_data/loaders";
import { formatMoney } from "@/lib/formatters";
import { HIGH_VALUE_MINOR } from "@/lib/crm/pipelineThresholds";
import { KanbanBoard } from "./_components/KanbanBoard";

export default async function PipelinePage({
  searchParams,
}: {
  searchParams?: { pipelineId?: string };
}) {
  const t = await getTranslations("crmPipelinePage");
  const selectedPipelineId = searchParams?.pipelineId;
  const [{ data: pipelines, source: pipelineSource }, { data: deals, source: dealsSource, total = null }] =
    await Promise.all([getPipelines(), getPipelineDeals(selectedPipelineId)]);

  const source = pipelineSource === "error" || dealsSource === "error" ? "error" : "api";
  // Honour the pipeline chosen via ?pipelineId when valid, else the first one.
  const pipeline =
    (selectedPipelineId && pipelines.find((p) => p.id === selectedPipelineId)) ||
    (pipelines.length > 0 ? pipelines[0] : null);

  const errored = source === "error";

  const totalDeals = deals.length;
  const totalValue = deals.reduce((sum, d) => sum + BigInt(d.valueMinor || "0"), 0n);
  const avgLikelihood = totalDeals > 0
    ? Math.round(deals.reduce((s, d) => s + d.probability, 0) / totalDeals)
    : 0;
  // GAP-CRM-PIPELINE-03: a named bigint-paise threshold (₹1 crore), not an
  // unlabelled magic 1_000_000 (₹10,000); the tile label states it so the
  // figure is never a mystery cut-off.
  const highValueDeals = deals.filter((d) => BigInt(d.valueMinor || "0") >= HIGH_VALUE_MINOR).length;

  // GAP-CRM-PIPELINE-05: the board shows the first PIPELINE_DEAL_LIMIT engagements.
  // The server now returns the true total, so we can say "N of M" exactly rather
  // than only warn on a full page; we keep the full-page heuristic as a fallback
  // for an older backend that returns no total.
  const possiblyTruncated = !errored && (total !== null ? total > totalDeals : totalDeals >= PIPELINE_DEAL_LIMIT);

  // GAP-CRM-PIPELINE-01: on a failed load the four StatCards used to print 0, ₹0.00 and
  // 0% — fabricating "an empty pipeline" as fact when the real cause is an outage. Show
  // "—" instead so a failure never reads as real zero figures (matching rti /
  // service-requests). The board itself (KanbanBoard) renders its own error state and
  // keeps any cached copy, so we don't blank it here.
  const dealsValue = errored ? "—" : totalDeals.toLocaleString("en-IN");
  const totalValueDisplay = errored ? "—" : formatMoney(totalValue);
  const likelihoodValue = errored ? "—" : `${avgLikelihood}%`;
  const highValueDisplay = errored ? "—" : highValueDeals.toLocaleString("en-IN");

  return (
    <>
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        back="/crm"
        actions={
          <a className="btn primary" href="/crm/deals/new">{t("newEngagement")}</a>
        }
      />
      {source === "error" && <DataSourceBadge source={source} />}
      {possiblyTruncated && (
        <p role="status" style={{ fontSize: 13, color: "#92400e", background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 8, padding: "8px 12px", margin: "8px 0" }}>
          {total !== null
            ? t("truncatedOf", { shown: totalDeals.toLocaleString("en-IN"), total: total.toLocaleString("en-IN") })
            : t("truncatedFirst", { limit: PIPELINE_DEAL_LIMIT.toLocaleString("en-IN") })}
        </p>
      )}
      <StatGrid>
        <StatCard icon="▣" iconBg="#e0f2fe" label={possiblyTruncated && total === null ? t("loadedEngagements") : t("totalEngagements")} value={errored ? "—" : (total !== null ? total.toLocaleString("en-IN") : dealsValue)} />
        <StatCard icon="◈" iconBg="#dcfce7" label={t("engagementValue")} value={totalValueDisplay} />
        <StatCard icon="◉" iconBg="#fef3c7" label={t("avgLikelihood")} value={likelihoodValue} />
        <StatCard
          icon="△"
          iconBg="#fce7f3"
          label={t("highValueEngagements", { threshold: formatMoney(HIGH_VALUE_MINOR) })}
          value={highValueDisplay}
        />
      </StatGrid>
      <KanbanBoard
        pipeline={pipeline}
        pipelines={pipelines}
        deals={deals}
        source={source as "api" | "error"}
      />
    </>
  );
}
