import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { PageHeader, StatGrid, StatCard, Card, RefreshErrorState, EmptyState } from "@/app/_components/ds";
import { toHumanError } from "@/lib/messages";
import type { MLDomainEvaluation } from "../_data";
import { metricForDomain, predictionKindForDomain, type MetricConfig, type PredictionKind } from "../_metrics";
import { AccuracyTrendChart } from "./AccuracyTrendChart";
import { FactorBreakdown } from "./FactorBreakdown";
import { RecentPredictionsTable } from "./RecentPredictionsTable";
import { ArrowLeft } from "lucide-react";

interface DomainInsightPageProps {
  title: string;
  subtitle: string;
  domain: string;
  evaluation: MLDomainEvaluation;
  source: "api" | "error";
  /** URL prefix for drill-through links from the predictions table */
  rowLinkPrefix?: string;
  /** Custom labels for the 4 stat cards */
  statLabels?: {
    predictions?: string;
    accuracy?: string;
    fallbackRate?: string;
    topFactor?: string;
  };
  /**
   * Optional override for the domain's metric semantics (label, direction,
   * thresholds). Defaults to the registry in ../_metrics keyed by `domain`.
   */
  metric?: MetricConfig;
  /** Optional override for how a row's prediction value is formatted. */
  predictionKind?: PredictionKind;
  /** Whether the user may export the predictions table (fail-closed default). */
  canExport?: boolean;
}

/**
 * Renders a 0..1 rate as a percentage. Only null/NaN reads as "—"; a genuine
 * 0 renders "0%" so a 0% fallback rate (the ideal) is not mistaken for
 * missing data. GAP-*-ML-INSIGHTS-*-05/06.
 */
function formatPct(value: number | null): string {
  return value == null || Number.isNaN(value) ? "—" : `${Math.round(value * 100)}%`;
}

/**
 * Shared layout for per-domain ML Insights pages.
 * Pattern: PageHeader → StatGrid → AccuracyTrendChart → FactorBreakdown → RecentPredictionsTable
 */
export function DomainInsightPage({
  title,
  subtitle,
  domain,
  evaluation,
  source,
  rowLinkPrefix,
  statLabels,
  metric,
  predictionKind,
  canExport = false,
}: DomainInsightPageProps) {
  const resolvedMetric = metric ?? metricForDomain(domain);
  const resolvedKind = predictionKind ?? predictionKindForDomain(domain);

  const header = (
    <>
      <nav aria-label="Breadcrumb" className="back">
        <ArrowLeft aria-hidden="true" size={14} /> <a href="/analytics/ml-insights">ML Insights</a>
      </nav>
      <PageHeader title={title} subtitle={subtitle} />
    </>
  );

  // A failed fetch must NOT read as "model inactive". fetchJson returns the
  // empty fallback with source:"error" on any failure; branch on that and
  // show an honest, retryable error state instead of zero stats + "once the
  // ML model is active" copy. GAP-*-ML-INSIGHTS-*-01 (FAILMASK).
  if (source === "error") {
    return (
      <div className="page-main wrap" aria-labelledby="page-heading">
        {header}
        <RefreshErrorState
          error={toHumanError("load", { area: "ML insights" })}
          backHref="/analytics/ml-insights"
        />
      </div>
    );
  }

  // source === "api": distinguish a healthy "no model / no predictions yet"
  // response from an error (handled above). Show one honest empty state
  // rather than a wall of zero stats. GAP-*-ML-INSIGHTS-SUBSCRIPTIONS-06.
  const hasData = evaluation.totalPredictions > 0;
  if (!hasData) {
    return (
      <div className="page-main wrap" aria-labelledby="page-heading">
        {header}
        <DataSourceBadge source="api" />
        <EmptyState
          icon="🤖"
          title={`No active model for ${title.replace(/\s+Insights$/, "")}`}
          message="There are no predictions in the last 30 days yet. This view will populate once the model is active and producing results."
          action={<a className="btn ghost" href="/analytics/ml-insights">Back to ML Insights</a>}
        />
      </div>
    );
  }

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      {header}
      <StatGrid>
        <StatCard
          icon="📊"
          iconBg="#eef2ff"
          label={statLabels?.predictions ?? "Total Predictions"}
          value={evaluation.totalPredictions.toLocaleString("en-IN")}
        />
        <StatCard
          icon="🎯"
          iconBg="#dcfce7"
          label={statLabels?.accuracy ?? resolvedMetric.label}
          value={formatPct(evaluation.accuracy)}
        />
        <StatCard
          icon="⚠️"
          iconBg="#fef9c3"
          label={statLabels?.fallbackRate ?? "Fallback Rate"}
          value={formatPct(evaluation.fallbackRate)}
        />
        <StatCard
          icon="🔑"
          iconBg="#dbeafe"
          label={statLabels?.topFactor ?? "Top Factor"}
          value={evaluation.topFactor}
        />
      </StatGrid>

      <Card title={`${resolvedMetric.label} Trend (30 days)${resolvedMetric.higherIsBetter ? "" : " — lower is better"}`}>
        <AccuracyTrendChart
          data={evaluation.accuracyTrend}
          metricLabel={resolvedMetric.label}
          higherIsBetter={resolvedMetric.higherIsBetter}
          thresholds={resolvedMetric.thresholds}
        />
      </Card>

      <Card title="Factor Breakdown">
        <FactorBreakdown factors={evaluation.factorBreakdown} />
      </Card>

      <Card title="Recent Predictions">
        <RecentPredictionsTable
          predictions={evaluation.recentPredictions}
          source={source}
          rowLinkPrefix={rowLinkPrefix}
          domain={domain}
          predictionKind={resolvedKind}
          canExport={canExport}
        />
      </Card>
    </div>
  );
}
