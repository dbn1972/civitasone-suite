"use client";
import { DataTable } from "@/app/_components/ds";
import { useSeededResource } from "@/lib/sync/resource";
type Row = Record<string, unknown>;
export function EditionsTable({ editions, source = "api" }: { editions: Row[]; source?: "api" | "error" }) {
  const { data: rows, fromCache, offline, cachedAt } = useSeededResource<Row[]>("sa.editions", editions, source, (d) => d.length === 0);
  const cacheNote = offline || fromCache ? `Showing saved data${cachedAt ? ` from ${new Date(cachedAt).toLocaleString("en-IN")}` : ""}${offline ? " — you're offline" : ""}.` : null;
  return (
    <>
      {cacheNote && <p role="status" aria-live="polite" style={{ fontSize: 12, color: "#92400e", margin: "0 0 8px" }}>{cacheNote}</p>}
      <DataTable<Row>
        columns={[
          { key: "name", label: "Edition" },
          { key: "modulesIncluded", label: "Modules", align: "center" },
          { key: "pricing", label: "Pricing" },
          { key: "tenants", label: "Tenants", align: "right" },
          { key: "status", label: "Status", cellType: "status" },
        ]}
        rows={rows} sortable filterable filterPlaceholder="Search editions…" pageSize={15} exportable exportFilename="editions" emptyIcon="📦" emptyTitle="No editions" emptyMessage="No platform editions configured."
      />
    </>
  );
}
