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
  // GAP-ANALYTICS-DASHBOARDS-03: show the owner (opaque id, shortened) so a
  // viewer can tell whose dashboard this is; "—" when unknown.
  {
    key: "ownerId",
    label: "Owner",
    render: (r) => (r.ownerId ? <span className="mono" title={r.ownerId}>{r.ownerId.slice(0, 8)}</span> : "—"),
  },
  // GAP-ANALYTICS-DASHBOARDS-04: let StatusPill humanize the value itself
  // ("Shared"/"Private"/"Unknown") instead of forcing SHOUTING uppercase; the
  // visibility/status words now have tones in STATUS_MAP.
  { key: "visibility", label: "Visibility", render: (r) => <StatusPill status={r.visibility} /> },
  { key: "status", label: "Status", render: (r) => <StatusPill status={r.status} /> },
  // GAP-ANALYTICS-DASHBOARDS-04: show a version like "v3", not a bare number.
  { key: "version", label: "Version", align: "right", render: (r) => `v${r.version}` },
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
          call as `rows`, so it can never disagree with what the table shows. */}
      <DataSourceBadge provenance={provenance ?? "live"} cachedAt={cachedAt} offline={offline} />
      <DataTable<AnalyticsDashboardRow>
        columns={columns}
        rows={rows}
        sortable
        filterable
        filterPlaceholder="Filter dashboards…"
        pageSize={15}
        identifyingColumnKey="name"
        rowHref={(r) => (r.id ? `/analytics/dashboards/${r.id}` : undefined)}
      />
    </>
  );
}
