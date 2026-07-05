"use client";
import { DataTable } from "@/app/_components/ds";
import { useSeededResource } from "@/lib/sync/resource";
type Row = Record<string, unknown>;
export function ApiMonitoringTable({ endpoints, source = "api" }: { endpoints: Row[]; source?: "api" | "error" }) {
  const { data: rows, fromCache, offline, cachedAt } = useSeededResource<Row[]>("sa.api-monitoring", endpoints, source, (d) => d.length === 0);
  const cacheNote = offline || fromCache ? `Showing saved data${cachedAt ? ` from ${new Date(cachedAt).toLocaleString("en-IN")}` : ""}${offline ? " — you're offline" : ""}.` : null;
  return (
    <>
      {cacheNote && <p role="status" aria-live="polite" style={{ fontSize: 12, color: "#92400e", margin: "0 0 8px" }}>{cacheNote}</p>}
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
