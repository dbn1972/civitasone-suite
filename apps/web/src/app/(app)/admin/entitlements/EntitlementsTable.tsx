"use client";
import { DataTable } from "@/app/_components/ds";
import { useSeededResource } from "@/lib/sync/resource";
type Row = Record<string, unknown>;
export function EntitlementsTable({ entitlements, source = "api" }: { entitlements: Row[]; source?: "api" | "error" }) {
  const { data: rows, fromCache, offline, cachedAt } = useSeededResource<Row[]>("sa.entitlements", entitlements, source, (d) => d.length === 0);
  const cacheNote = offline || fromCache ? `Showing saved data${cachedAt ? ` from ${new Date(cachedAt).toLocaleString("en-IN")}` : ""}${offline ? " — you're offline" : ""}.` : null;
  return (
    <>
      {cacheNote && <p role="status" aria-live="polite" style={{ fontSize: 12, color: "#92400e", margin: "0 0 8px" }}>{cacheNote}</p>}
      <DataTable<Row>
        columns={[
          { key: "module", label: "Module" },
          { key: "edition", label: "Edition" },
          { key: "tenant", label: "Tenant Override" },
          { key: "limit", label: "Limit" },
          { key: "used", label: "Used", align: "right" },
          { key: "status", label: "Status", cellType: "status" },
        ]}
        rows={rows} sortable filterable filterPlaceholder="Search entitlements…" pageSize={15} exportable exportFilename="entitlements" emptyIcon="🔑" emptyTitle="No entitlements" emptyMessage="No entitlements configured."
      />
    </>
  );
}
