"use client";

import type { ReactNode } from "react";
import { DataTable, StatusPill } from "@/app/_components/ds";
import { formatIndianDate } from "@/lib/formatters";
import { useSeededResource } from "@/lib/sync/resource";
import type { AnalyticsDashboardRow } from "../_data";

type Col = {
  key: keyof AnalyticsDashboardRow & string;
  label: string;
  align?: "left" | "right" | "center";
  render?: (row: AnalyticsDashboardRow) => ReactNode;
};

const columns: Col[] = [
  { key: "name", label: "Name" },
  { key: "description", label: "Description", render: (r) => r.description ?? "—" },
  { key: "visibility", label: "Visibility", render: (r) => <StatusPill status={r.visibility} label={r.visibility.toUpperCase()} /> },
  { key: "status", label: "Status", render: (r) => <StatusPill status={r.status} label={r.status.toUpperCase()} /> },
  { key: "version", label: "Version", align: "right" },
];

export function DashboardsTable({
  dashboards,
  source = "api",
}: {
  dashboards: AnalyticsDashboardRow[];
  source?: "api" | "error";
}) {
  const { data: rows, fromCache, offline, cachedAt } = useSeededResource<AnalyticsDashboardRow[]>(
    "analytics.dashboards",
    dashboards,
    source,
    (d) => d.length === 0,
  );

  const cacheNote =
    offline || fromCache
      ? `Showing saved data${cachedAt ? ` from ${formatIndianDate(new Date(cachedAt).toISOString())}` : ""}${offline ? " — you're offline" : ""}.`
      : null;

  return (
    <>
      {/* aria-live so assistive tech announces the offline/cached state change */}
      <p role="status" aria-live="polite" style={{ fontSize: 12, color: "#92400e", margin: "0 0 8px", minHeight: 16 }}>
        {cacheNote ?? ""}
      </p>
      <DataTable<AnalyticsDashboardRow>
        columns={columns}
        rows={rows}
        sortable
        filterable
        filterPlaceholder="Filter dashboards…"
        pageSize={15}
      />
    </>
  );
}
