import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { Card, PageHeader, StatCard, StatGrid } from "../../../_components/ds";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { LoadErrorState } from "../../../_components/ds/LoadErrorState";
import { getCrmForecast, getPipelines } from "../../../_data/loaders";
import { formatMoney } from "@/lib/formatters";
import { averageWeightedDealMinor, rankStages, topContributingStage } from "./forecast";
import { PipelineFilter } from "./PipelineFilter";
import { PeriodFilter } from "./PeriodFilter";
import { localizedPeriodLabel, resolvePeriod } from "./period";
import { StageBreakdownTable } from "./StageBreakdownTable";

interface PageProps {
  searchParams?: { pipelineId?: string; period?: string };
}

export default async function ForecastPage({ searchParams }: PageProps) {
  const t = await getTranslations("crmForecastPeriod");
  const pipelineId = searchParams?.pipelineId;
  // GAP-CRM-FORECAST-03: resolve the chosen FY quarter / year to a close-date window so
  // the weighted total is tied to a horizon, and name that horizon in the subtitle.
  const period = resolvePeriod(searchParams?.period);
  const [forecastResult, pipelineResult] = await Promise.all([
    getCrmForecast(pipelineId, period ? { closeDateFrom: period.closeDateFrom, closeDateTo: period.closeDateTo } : undefined),
    getPipelines(),
  ]);
  const { data: forecast, source: forecastSource } = forecastResult;
  const { data: pipelines, source: pipelineSource } = pipelineResult;

  const stages = rankStages(forecast);
  const topStage = topContributingStage(forecast);
  const periodSuffix = period ? ` · ${localizedPeriodLabel(period, (k, v) => t(k, v))}` : ` · ${t("allOpenDeals")}`;

  // GAP-CRM-FORECAST-01: on a failed forecast load the tiles used to print ₹0.00 / 0
  // deals and the table "No forecast yet" — an outage read as a genuinely empty
  // pipeline, which misleads a pipeline review. When the forecast itself failed, show
  // a real error state (with retry) instead of fabricated zeros. A pipelines-only
  // failure (GAP-CRM-FORECAST-02) still renders the forecast with a filter notice.
  if (forecastSource === "error") {
    return (
      <>
        <PageHeader
          title={t("errTitle")}
          subtitle={t("errSubtitle")}
          back="/crm"
        />
        <LoadErrorState
          result={{ status: forecastResult.status, errorMessage: forecastResult.errorMessage }}
          area={t("loadArea")}
          backHref="/crm"
        />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Procurement Pipeline Forecast"
        subtitle={t("subtitle", { periodSuffix })}
        back="/crm"
        actions={<Link className="btn" href="/crm/pipeline">Engagement Board</Link>}
      />
      {pipelineSource === "error" && <DataSourceBadge source="error" />}
      <StatGrid>
        {/* GAP-CRM-FORECAST-06: tone tokens (dark-mode aware) instead of fixed
            pastel hex iconBg values that stayed pale in dark mode. */}
        <StatCard
          icon="▣"
          tone="good"
          label="Weighted Forecast"
          value={formatMoney(forecast.totalForecastMinor)}
        />
        <StatCard
          icon="◉"
          tone="info"
          label="Engagements in Forecast"
          value={forecast.dealCount.toLocaleString("en-IN")}
        />
        <StatCard
          icon="◈"
          tone="warn"
          label="Avg Weighted Engagement"
          value={formatMoney(averageWeightedDealMinor(forecast))}
        />
        <StatCard
          icon="△"
          tone="neutral"
          label="Top Stage"
          value={topStage ? topStage.stageName : "—"}
        />
      </StatGrid>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 24, alignItems: "center" }}>
        <PipelineFilter pipelines={pipelines.map((p) => ({ id: p.id, name: p.name }))} pipelinesFailed={pipelineSource === "error"} />
        <PeriodFilter />
      </div>

      <Card title="Forecast by Stage">
        <StageBreakdownTable stages={stages} />
      </Card>
    </>
  );
}
