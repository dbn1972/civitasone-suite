"use client";

import { DataTable } from "@/app/_components/ds";
import { useSeededResource } from "@/lib/sync/resource";
import type { AnalyticsDataWarehouseRow } from "@/app/_data/loaders";

const COLUMNS: { key: keyof AnalyticsDataWarehouseRow & string; label: string; align?: "right"; cellType?: "status" }[] = [
  { key: "dataset", label: "Dataset" },
  { key: "lastRefresh", label: "Last Refresh" },
  { key: "records", label: "Records", align: "right" },
  { key: "size", label: "Size", align: "right" },
  { key: "qualityScore", label: "Quality Score" },
  { key: "status", label: "Status", cellType: "status" },
];

export function DataWarehouseTable({ rows, source = "api" }: { rows: AnalyticsDataWarehouseRow[]; source?: "api" | "error" }) {
  const { data, fromCache, offline, cachedAt } = useSeededResource<AnalyticsDataWarehouseRow[]>(
    "analytics.data-warehouse",
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
      <DataTable<AnalyticsDataWarehouseRow>
        columns={COLUMNS}
        rows={data}
        sortable
        filterable
        filterPlaceholder="Search datasets…"
        pageSize={15}
        exportable
        exportFilename="analytics-datasets"
        emptyIcon="🗄️"
        emptyTitle="No datasets"
        emptyMessage="No datasets match the current filter."
      />
    </>
  );
}
