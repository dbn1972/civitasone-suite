"use client";
import { DataTable } from "@/app/_components/ds";
import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { useSeededResource } from "@/lib/sync/resource";
type Row = Record<string, unknown>;
export function GatewaysTable({ gateways, source = "api" }: { gateways: Row[]; source?: "api" | "error" }) {
  const { data: rows, provenance, offline, cachedAt } = useSeededResource<Row[]>("sa.gateways", gateways, source, (d) => d.length === 0);
  return (
    <>
      {/* UX-012: this badge is the ONLY place that reports data provenance for
          the rows shown below — it reads the same useSeededResource call as
          `rows`, so it can never disagree with what the table shows
          (UX-002's pattern; the page used to render a second, independent
          badge from the raw `source` prop — removed). */}
      <DataSourceBadge provenance={provenance ?? "live"} cachedAt={cachedAt} offline={offline} />
      <DataTable<Row>
        columns={[
          { key: "type", label: "Type" },
          { key: "provider", label: "Provider" },
          { key: "messagesPerDay", label: "Messages/Day", align: "right" },
          { key: "successRate", label: "Success Rate" },
          { key: "lastChecked", label: "Last Checked" },
          { key: "status", label: "Status", cellType: "status" },
        ]}
        rows={rows} sortable filterable filterPlaceholder="Search gateways…" pageSize={15} exportable exportFilename="gateways" emptyIcon="📡" emptyTitle="No gateways" emptyMessage="No communication gateways configured."
      />
    </>
  );
}
