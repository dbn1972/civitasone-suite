"use client";

import { formatIndianDateTime } from "@/lib/formatters";
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

/** Display string for a KPI target: null/undefined -> em dash, numbers formatted by unit. */
export function formatKpiTarget(row: Pick<AnalyticsKpiRow, "target" | "unit">): string {
  const t = row.target;
  if (t === null || t === undefined || t === "") return "—";
  if (typeof t === "string") return t;
  if (!Number.isFinite(t)) return "—";
  const n = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 1 });
  switch (row.unit) {
    case "paise": return "₹" + n.format(Math.round(t / 100));
    case "percent": return n.format(t) + "%";
    case "days": return n.format(t) + "d";
    default: return n.format(t);
  }
}

export function KpiTable({ rows, source = "api" }: { rows: AnalyticsKpiRow[]; source?: "api" | "error" }) {
  const { data, fromCache, offline, cachedAt } = useSeededResource<AnalyticsKpiRow[]>(
    "analytics.kpis",
    rows,
    source,
    (d) => d.length === 0,
  );

  const displayRows = data.map((r) => ({ ...r, target: formatKpiTarget(r) }));

  const cacheNote =
    offline || fromCache
      ? `Showing saved data${cachedAt ? ` from ${formatIndianDateTime(cachedAt)}` : ""}${offline ? " — you're offline" : ""}.`
      : null;

  return (
    <>
      {cacheNote && <p role="status" aria-live="polite" style={{ fontSize: 12, color: "var(--warn)", margin: "0 0 8px" }}>{cacheNote}</p>}
      <DataTable<AnalyticsKpiRow>
        columns={COLUMNS}
        rows={displayRows}
        sortable
        filterable
        filterPlaceholder="Search KPIs…"
        pageSize={15}
        exportable exportAudit="analytics/kpi"
        exportFilename="analytics-kpis"
        emptyIcon="🎯"
        emptyTitle="No KPIs"
        emptyMessage="No KPIs match the current filter."
      />
    </>
  );
}
