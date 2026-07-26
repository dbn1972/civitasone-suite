import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { PageHeader, StatGrid, StatCard, Card } from "@/app/_components/ds";
import type { MLDomainEvaluation } from "../_data";
import { AccuracyTrendChart } from "./AccuracyTrendChart";
import { FactorBreakdown } from "./FactorBreakdown";
import { RecentPredictionsTable } from "./RecentPredictionsTable";

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
}

function formatPct(value: number): string {
  return value > 0 ? `${Math.round(value * 100)}%` : "—";
}

/**
 * Shared layout for per-domain ML Insights pages.
 * Pattern: PageHeader → StatGrid → AccuracyTrendChart → FactorBreakdown → RecentPredictionsTable
 */
export function DomainInsightPage({
  title,
  subtitle,
  evaluation,
  source,
  rowLinkPrefix,
  statLabels,
}: DomainInsightPageProps) {
  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <nav aria-label="Breadcrumb" className="back">
        ← <a href="/analytics/ms-insights">ML Insights</a>
      </nav>
      <PageHeader title={title} subtitle={subtitle} />
      {source === "error" && <DataSourceBadge source="error" />}
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
          label={statLabels?.accuracy ?? "Accuracy"}
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

      <Card title="Accuracy Trend (30 days)">
        <AccuracyTrendChart data={evaluation.accuracyTrend} />
      </Card>

      <Card title="Factor Breakdown">
        <FactorBreakdown factors={evaluation.factorBreakdown} />
      </Card>

      <Card title="Recent Predictions">
        <RecentPredictionsTable
          predictions={evaluation.recentPredictions}
          source={source}
          rowLinkPrefix={rowLinkPrefix}
        />
      </Card>
    </main>
  );
}
