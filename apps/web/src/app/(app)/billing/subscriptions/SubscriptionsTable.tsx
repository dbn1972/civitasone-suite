"use client";

import { Card, EmptyState } from "../../../_components/ds";
import { PredictionBadge } from "../../../_components/ds/PredictionBadge";
import { useSeededResource } from "@/lib/sync/resource";
import type { ModuleRowSummary } from "@civitasone/types";

export type SubscriptionRow = ModuleRowSummary & {
  churnRisk?: {
    probability: number;
    confidence: number;
    factors?: Array<{ feature: string; contribution: number; direction: "positive" | "negative" }>;
    isFallback?: boolean;
  } | null;
};

export function SubscriptionsTable({
  cacheKey,
  rows,
  source,
}: {
  cacheKey: string;
  rows: SubscriptionRow[];
  source: "api" | "error";
}) {
  const { data, fromCache, offline, cachedAt } = useSeededResource<SubscriptionRow[]>(
    cacheKey,
    rows,
    source,
    (d) => d.length === 0,
  );

  const cacheNote =
    offline || fromCache
      ? `Showing saved data${cachedAt ? ` from ${new Date(cachedAt).toLocaleString("en-IN")}` : ""}${offline ? " — you're offline" : ""}.`
      : null;

  return (
    <Card title="Subscriptions">
      {cacheNote ? (
        <p role="status" aria-live="polite" style={{ fontSize: 12, color: "#92400e", margin: "0", padding: "8px 16px 0" }}>
          {cacheNote}
        </p>
      ) : null}
      {data.length === 0 ? (
        <EmptyState icon="📋" title="No subscriptions" message="No subscriptions have been created yet." />
      ) : (
        <table className="tbl">
          <thead>
            <tr>
              <th>ID</th>
              <th>Name</th>
              <th>Detail</th>
              <th>Status</th>
              <th>Churn Risk</th>
              <th>Meta</th>
            </tr>
          </thead>
          <tbody>
            {data.map((row) => (
              <tr key={row.id}>
                <td><span className="mono">{row.id.slice(0, 8)}</span></td>
                <td>{row.label}</td>
                <td>{row.sublabel ?? "—"}</td>
                <td>{row.status ?? "—"}</td>
                <td>
                  {row.churnRisk ? (
                    <PredictionBadge
                      confidence={row.churnRisk.confidence}
                      label={`${Math.round(row.churnRisk.probability * 100)}% churn`}
                      factors={row.churnRisk.factors}
                      isFallback={row.churnRisk.isFallback}
                    />
                  ) : (
                    "—"
                  )}
                </td>
                <td>{row.meta ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}
