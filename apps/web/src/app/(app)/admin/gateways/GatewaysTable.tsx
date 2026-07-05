"use client";
import { DataTable } from "@/app/_components/ds";
import { useSeededResource } from "@/lib/sync/resource";
type Row = Record<string, unknown>;
export function GatewaysTable({ gateways, source = "api" }: { gateways: Row[]; source?: "api" | "error" }) {
  const { data: rows, fromCache, offline, cachedAt } = useSeededResource<Row[]>("sa.gateways", gateways, source, (d) => d.length === 0);
  const cacheNote = offline || fromCache ? `Showing saved data${cachedAt ? ` from ${new Date(cachedAt).toLocaleString("en-IN")}` : ""}${offline ? " — you're offline" : ""}.` : null;
  return (
    <>
      {cacheNote && <p role="status" aria-live="polite" style={{ fontSize: 12, color: "#92400e", margin: "0 0 8px" }}>{cacheNote}</p>}
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
