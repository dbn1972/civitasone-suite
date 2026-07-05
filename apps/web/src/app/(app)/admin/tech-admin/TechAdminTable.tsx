"use client";
import { DataTable } from "@/app/_components/ds";
import { useSeededResource } from "@/lib/sync/resource";
type Row = Record<string, unknown>;
export function TechAdminTable({ services, source = "api" }: { services: Row[]; source?: "api" | "error" }) {
  const { data: rows, fromCache, offline, cachedAt } = useSeededResource<Row[]>("sa.tech-admin", services, source, (d) => d.length === 0);
  const cacheNote = offline || fromCache ? `Showing saved data${cachedAt ? ` from ${new Date(cachedAt).toLocaleString("en-IN")}` : ""}${offline ? " — you're offline" : ""}.` : null;
  return (
    <>
      {cacheNote && <p role="status" aria-live="polite" style={{ fontSize: 12, color: "#92400e", margin: "0 0 8px" }}>{cacheNote}</p>}
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
