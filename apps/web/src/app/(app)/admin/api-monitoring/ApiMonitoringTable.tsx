"use client";
import { DataTable } from "@/app/_components/ds";
import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { useSeededResource } from "@/lib/sync/resource";
type Row = Record<string, unknown>;
export function ApiMonitoringTable({ endpoints, source = "api" }: { endpoints: Row[]; source?: "api" | "error" }) {
  const { data: rows, provenance, offline, cachedAt } = useSeededResource<Row[]>("sa.api-monitoring", endpoints, source, (d) => d.length === 0);
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
          { key: "service", label: "Service" },
          { key: "endpoint", label: "Endpoint" },
          { key: "p95Latency", label: "p95 (ms)", align: "right" },
          { key: "errorRate", label: "Error Rate" },
          { key: "requestsPerMin", label: "Req/min", align: "right" },
          { key: "status", label: "Status", cellType: "status" },
        ]}
        rows={rows} sortable filterable filterPlaceholder="Search APIs…" pageSize={20} exportable exportFilename="api-monitoring" emptyIcon="🔌" emptyTitle="No API data" emptyMessage="API monitoring data not available."
      />
    </>
  );
}
