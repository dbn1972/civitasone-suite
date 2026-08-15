import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { Card, PageHeader, StatCard, StatGrid } from "../../../_components/ds";
import { getCrmForecast, getPipelines } from "../../../_data/loaders";
import { formatMoney } from "@/lib/formatters";
import { averageWeightedDealMinor, rankStages, topContributingStage } from "./forecast";
import { PipelineFilter } from "./PipelineFilter";
import { StageBreakdownTable } from "./StageBreakdownTable";

interface PageProps {
  searchParams?: { pipelineId?: string };
}

export default async function ForecastPage({ searchParams }: PageProps) {
  const pipelineId = searchParams?.pipelineId;
  const [{ data: forecast, source: forecastSource }, { data: pipelines, source: pipelineSource }] =
    await Promise.all([getCrmForecast(pipelineId), getPipelines()]);

  const source = forecastSource === "error" || pipelineSource === "error" ? "error" : "api";
  const stages = rankStages(forecast);
  const topStage = topContributingStage(forecast);

  return (
    <>
      <PageHeader
        title="Procurement Pipeline Forecast"
        subtitle="Weighted engagement value — each active procurement tracked at its stage likelihood • पाइपलाइन पूर्वानुमान"
        back="/crm"
        actions={<a className="btn" href="/crm/pipeline">Engagement Board</a>}
      />
      {source === "error" && <DataSourceBadge source={source} />}
      <StatGrid>
        <StatCard
          icon="▣"
          iconBg="#dcfce7"
          label="Weighted Forecast"
          value={formatMoney(forecast.totalForecastMinor)}
        />
        <StatCard
          icon="◉"
          iconBg="#e0f2fe"
          label="Engagements in Forecast"
          value={forecast.dealCount.toLocaleString("en-IN")}
        />
        <StatCard
          icon="◈"
          iconBg="#fef3c7"
          label="Avg Weighted Engagement"
          value={formatMoney(averageWeightedDealMinor(forecast))}
        />
        <StatCard
          icon="△"
          iconBg="#fce7f3"
          label="Top Stage"
          value={topStage ? topStage.stageName : "—"}
        />
      </StatGrid>

      <PipelineFilter pipelines={pipelines.map((p) => ({ id: p.id, name: p.name }))} />

      <Card title="Forecast by Stage">
        <StageBreakdownTable stages={stages} />
      </Card>
    </>
  );
}
