"use client";
import { DataTable } from "@/app/_components/ds";
import { useSeededResource } from "@/lib/sync/resource";
type Row = Record<string, unknown>;
export function MeteringTable({ meters, source = "api" }: { meters: Row[]; source?: "api" | "error" }) {
  const { data: rows, fromCache, offline, cachedAt } = useSeededResource<Row[]>("sa.metering", meters, source, (d) => d.length === 0);
  const cacheNote = offline || fromCache ? `Showing saved data${cachedAt ? ` from ${new Date(cachedAt).toLocaleString("en-IN")}` : ""}${offline ? " — you're offline" : ""}.` : null;
  return (
    <>
      {cacheNote && <p role="status" aria-live="polite" style={{ fontSize: 12, color: "#92400e", margin: "0 0 8px" }}>{cacheNote}</p>}
      <DataTable<Row>
        columns={[
          { key: "tenant", label: "Tenant" },
          { key: "apiCalls", label: "API Calls", align: "right" },
          { key: "storage", label: "Storage" },
          { key: "users", label: "Users", align: "right" },
          { key: "billingPeriod", label: "Period" },
          { key: "amount", label: "Amount (₹)", align: "right" },
          { key: "status", label: "Status", cellType: "status" },
        ]}
        rows={rows} sortable filterable filterPlaceholder="Search metering…" pageSize={15} exportable exportFilename="usage-metering" emptyIcon="📊" emptyTitle="No metering data" emptyMessage="No usage metering records found."
      />
    </>
  );
}
