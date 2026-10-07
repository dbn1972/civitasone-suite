import { Card, StatGrid, StatCard } from "@/app/_components/ds";
import { RefreshErrorState } from "@/app/_components/ds/RefreshErrorState";
import { toHumanError } from "@/lib/messages";
import { humanizeStatus } from "@/lib/formatters";
import type { LoaderSource } from "@/app/_data/apiClient";
import type { JourneyAnalytics } from "../_data";

/**
 * GAP-JOURNEYS-ANALYTICS-01: real funnel figures (total / running / completed /
 * failed) plus a per-status breakdown bar chart, derived from the executions
 * list, replacing the Active table that was being shown verbatim on Analytics.
 * `total` is the server-reported total; the per-status breakdown is over the
 * current page and is labelled as such.
 */

const BAR_W = 320;
const BAR_H = 160;
const BAR_PAD = 8;
const BAR_GAP = 10;
const LABEL_H = 22;

function StatusBreakdownChart({ data }: { data: Array<{ status: string; count: number }> }) {
  const items = data.slice(0, 7);
  if (items.length === 0) return null;
  const maxVal = Math.max(...items.map((c) => c.count), 1);
  const n = items.length;
  const barW = Math.floor((BAR_W - BAR_PAD * 2 - BAR_GAP * (n - 1)) / n);
  const chartH = BAR_H - LABEL_H;
  return (
    <svg width="100%" viewBox={`0 0 ${BAR_W} ${BAR_H}`} aria-label="Executions by status bar chart" role="img">
      {items.map((cat, i) => {
        const ratio = cat.count / maxVal;
        const barH = Math.max(4, Math.round(ratio * (chartH - 6)));
        const x = BAR_PAD + i * (barW + BAR_GAP);
        const y = chartH - barH;
        const opacity = 0.45 + (i / Math.max(n - 1, 1)) * 0.5;
        const human = humanizeStatus(cat.status);
        const label = human.length > 10 ? human.slice(0, 9) + "…" : human;
        return (
          <g key={cat.status}>
            <rect x={x} y={y} width={barW} height={barH} rx={4} fill="#4f46e5" opacity={opacity} />
            <text x={x + barW / 2} y={chartH - barH - 3} textAnchor="middle" fontSize={9} fill="#101828">
              {cat.count}
            </text>
            <text x={x + barW / 2} y={BAR_H - 2} textAnchor="middle" fontSize={9} fill="#667085">
              {label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export function AnalyticsView({
  analytics,
  source,
}: {
  analytics: JourneyAnalytics;
  source: LoaderSource;
}) {
  if (source === "error") {
    return (
      <Card title="Analytics">
        <RefreshErrorState
          error={toHumanError("load", { area: "journey analytics" })}
          source={{ area: "journey analytics" }}
        />
      </Card>
    );
  }

  const completionRate =
    analytics.total > 0 ? `${Math.round((analytics.completed / analytics.total) * 100)}%` : "—";

  return (
    <>
      <StatGrid>
        <StatCard icon="📊" tone="neutral" label="Total executions" value={analytics.total} />
        <StatCard icon="🏃" tone="info" label="Running" value={analytics.running} />
        <StatCard icon="✅" tone="good" label="Completed" value={analytics.completed} />
        <StatCard icon="📈" tone="neutral" label="Completion rate" value={completionRate} hint="Completed executions as a share of total." />
      </StatGrid>
      <Card title="Executions by status">
        {analytics.byStatus.length === 0 ? (
          <p style={{ color: "var(--muted)", fontSize: 13 }}>No executions to analyse yet.</p>
        ) : (
          <>
            <div className="pad"><StatusBreakdownChart data={analytics.byStatus} /></div>
            <p style={{ color: "var(--muted)", fontSize: 12, marginTop: 8 }}>
              Breakdown is over the most recent {analytics.byStatus.reduce((a, b) => a + b.count, 0)} executions.
            </p>
          </>
        )}
      </Card>
    </>
  );
}
