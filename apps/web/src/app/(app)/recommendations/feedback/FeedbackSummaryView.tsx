"use client";

/**
 * GAP-RECOMMENDATIONS-FEEDBACK-01 / FEEDBACK-02: the feedback page promised
 * "acceptance and rejection analytics" but rendered a raw event list — and was
 * wired to an endpoint that REQUIRES a recommendationId, so the hub-level call
 * could not succeed at all. recommendation-service exposes exactly one
 * tenant-wide feedback aggregate: the rejection-reason summary
 * (GET /v1/recommendations/feedback/rejection-summary). This view shows that
 * aggregate honestly — total rejections and the count per reason code — rather
 * than inventing an acceptance rate the backend does not provide.
 */
import { Card, StatGrid, StatCard, EmptyState } from "@/app/_components/ds";
import { DataTable } from "@/app/_components/ds/DataTable";
import { humanizeStatus } from "@/lib/formatters";
import type { FeedbackSummary } from "../_data";

export function FeedbackSummaryView({ summary }: { summary: FeedbackSummary }) {
  const rows = summary.byReason
    .filter((r) => r.count > 0)
    .map((r) => ({ id: r.reasonCode, reason: humanizeStatus(r.reasonCode), count: r.count }));

  return (
    <>
      <StatGrid>
        <StatCard icon="📉" tone="bad" label="Total rejections" value={summary.totalRejections} />
        <StatCard
          icon="❓"
          tone="neutral"
          label="Uncoded rejections"
          hint="Rejections recorded before structured reason codes were introduced."
          value={summary.uncodedRejections}
        />
        <StatCard icon="🏷️" tone="info" label="Reason codes in use" value={rows.length} />
      </StatGrid>
      <Card title="Rejections by reason">
        {rows.length === 0 ? (
          <EmptyState
            icon="📋"
            title="No rejection reasons yet"
            message="No coded rejection feedback has been recorded for this tenant."
          />
        ) : (
          <DataTable<{ id: string; reason: string; count: number } & Record<string, unknown>>
            caption="Rejection feedback grouped by reason code"
            rows={rows as ({ id: string; reason: string; count: number } & Record<string, unknown>)[]}
            columns={[
              { key: "reason", label: "Reason" },
              { key: "count", label: "Count", align: "right" },
            ]}
            sortable
          />
        )}
      </Card>
    </>
  );
}
