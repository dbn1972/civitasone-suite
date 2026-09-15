"use client";

import type { ReactNode } from "react";
import { DataTable, StatusPill } from "@/app/_components/ds";
import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
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
  const { data: rows, provenance, offline, cachedAt } = useSeededResource<AnalyticsDashboardRow[]>(
    "analytics.dashboards",
    dashboards,
    source,
    (d) => d.length === 0,
  );

  return (
    <>
      {/* UX-012: this badge is the ONLY place that reports data provenance
          for the rows shown below — it reads the same useSeededResource
          call as `rows`, so it can never disagree with what the table shows
          (UX-002's pattern; the page used to render a second, independent
          badge from the raw `source` prop — removed). */}
      <DataSourceBadge provenance={provenance ?? "live"} cachedAt={cachedAt} offline={offline} />
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
