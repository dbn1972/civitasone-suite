"use client";

import { DataTable } from "@/app/_components/ds";
import { useSeededResource } from "@/lib/sync/resource";
import type { AnalyticsAiInsightRow } from "@/app/_data/loaders";

const COLUMNS: { key: keyof AnalyticsAiInsightRow & string; label: string; cellType?: "status" }[] = [
  { key: "insightTitle", label: "Insight" },
  { key: "module", label: "Module" },
  { key: "confidence", label: "Confidence" },
  { key: "generatedDate", label: "Generated" },
  { key: "actionRecommended", label: "Recommended Action" },
  { key: "status", label: "Status", cellType: "status" },
];

export function AiInsightsTable({ rows, source = "api" }: { rows: AnalyticsAiInsightRow[]; source?: "api" | "error" }) {
  const { data, fromCache, offline, cachedAt } = useSeededResource<AnalyticsAiInsightRow[]>(
    "analytics.ai-insights",
    rows,
    source,
    (d) => d.length === 0,
  );

  const cacheNote =
    offline || fromCache
      ? `Showing saved data${cachedAt ? ` from ${new Date(cachedAt).toLocaleString("en-IN")}` : ""}${offline ? " — you're offline" : ""}.`
      : null;

  return (
    <>
      {cacheNote && <p role="status" aria-live="polite" style={{ fontSize: 12, color: "#92400e", margin: "0 0 8px" }}>{cacheNote}</p>}
      <DataTable<AnalyticsAiInsightRow>
        columns={COLUMNS}
        rows={data}
        sortable
        filterable
        filterPlaceholder="Search insights…"
        pageSize={15}
        exportable
        exportFilename="analytics-ai-insights"
        emptyIcon="🤖"
        emptyTitle="No insights"
        emptyMessage="No insights match the current filter."
      />
    </>
  );
}
