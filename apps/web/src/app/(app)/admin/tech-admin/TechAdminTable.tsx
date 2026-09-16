"use client";
import { DataTable } from "@/app/_components/ds";
import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { useSeededResource } from "@/lib/sync/resource";
type Row = Record<string, unknown>;
export function TechAdminTable({ services, source = "api" }: { services: Row[]; source?: "api" | "error" }) {
  const { data: rows, provenance, offline, cachedAt } = useSeededResource<Row[]>("sa.tech-admin", services, source, (d) => d.length === 0);
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
          { key: "serviceName", label: "Service" },
          { key: "port", label: "Port" },
          { key: "dbConnections", label: "DB Conns", align: "right" },
          { key: "memory", label: "Memory" },
          { key: "uptime", label: "Uptime" },
          { key: "status", label: "Status", cellType: "status" },
        ]}
        rows={rows} sortable filterable filterPlaceholder="Search services…" pageSize={20} exportable exportFilename="tech-admin" emptyIcon="⚙️" emptyTitle="No services" emptyMessage="Service health data not available."
      />
    </>
  );
}
