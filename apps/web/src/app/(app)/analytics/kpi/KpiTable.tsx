"use client";

import { DataTable } from "@/app/_components/ds";
import { useSeededResource } from "@/lib/sync/resource";
import type { AnalyticsKpiRow } from "@/app/_data/loaders";

const COLUMNS: { key: keyof AnalyticsKpiRow & string; label: string }[] = [
  { key: "kpiName", label: "KPI Name" },
  { key: "category", label: "Category" },
  { key: "currentValue", label: "Current Value" },
  { key: "target", label: "Target" },
  { key: "trend", label: "Trend" },
  { key: "owner", label: "Owner" },
];

export function KpiTable({ rows, source = "api" }: { rows: AnalyticsKpiRow[]; source?: "api" | "error" }) {
  const { data, fromCache, offline, cachedAt } = useSeededResource<AnalyticsKpiRow[]>(
    "analytics.kpis",
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
      <DataTable<AnalyticsKpiRow>
        columns={COLUMNS}
        rows={data}
        sortable
        filterable
        filterPlaceholder="Search KPIs…"
        pageSize={15}
        exportable
        exportFilename="analytics-kpis"
        emptyIcon="🎯"
        emptyTitle="No KPIs"
        emptyMessage="No KPIs match the current filter."
      />
    </>
  );
}
