"use client";

import { useMemo } from "react";
import { Card, DataTable, EmptyState } from "../../../_components/ds";
import { useSeededResource } from "@/lib/sync/resource";
import type { CitizenPortalMetric } from "../../../_data/loaders";

type PortalRow = {
  id: string;
  metric: string;
  category: string;
  currentMonth: string;
  previousMonth: string;
  change: string;
  status: string;
} & Record<string, unknown>;

export function PortalTable({ metrics, source = "api" }: { metrics: CitizenPortalMetric[]; source?: "api" | "error" }) {
  const { data: rows, fromCache, offline, cachedAt } = useSeededResource<CitizenPortalMetric[]>(
    "citizen.portal",
    metrics,
    source,
    (d) => d.length === 0,
  );

  const tableRows = useMemo<PortalRow[]>(
    () =>
      rows.map((m) => ({
        id: m.id,
        metric: m.metric,
        category: m.category,
        currentMonth: m.currentMonth,
        previousMonth: m.previousMonth,
        change: m.change,
        status: m.status,
      })),
    [rows],
  );

  const cacheNote =
    offline || fromCache
      ? `Showing saved data${cachedAt ? ` from ${new Date(cachedAt).toLocaleString("en-IN")}` : ""}${offline ? " — you're offline" : ""}.`
      : null;

  return (
    <Card title="Monthly Performance">
      {cacheNote ? (
        <p role="status" aria-live="polite" style={{ fontSize: 12, color: "#92400e", margin: "0", padding: "8px 16px 0" }}>
          {cacheNote}
        </p>
      ) : null}
      {tableRows.length === 0 ? (
        <EmptyState icon="📊" title="No metrics available" message="Portal performance metrics will appear here once data flows in." />
      ) : (
        <DataTable<PortalRow>
          rows={tableRows}
          sortable
          filterable
          filterPlaceholder="Search metric, category…"
          pageSize={15}
          exportable
          exportFilename="citizen-portal-metrics"
          columns={[
            { key: "metric", label: "Metric" },
            { key: "category", label: "Category" },
            { key: "currentMonth", label: "Current Month" },
            { key: "previousMonth", label: "Previous Month" },
            { key: "change", label: "Change" },
            { key: "status", label: "Status", cellType: "status" },
          ]}
        />
      )}
    </Card>
  );
}
