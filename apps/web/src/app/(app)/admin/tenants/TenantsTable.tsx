"use client";
import { DataTable } from "@/app/_components/ds";
import { useSeededResource } from "@/lib/sync/resource";
type Row = Record<string, unknown>;
export function TenantsTable({ tenants, source = "api" }: { tenants: Row[]; source?: "api" | "error" }) {
  const { data: rows, fromCache, offline, cachedAt } = useSeededResource<Row[]>("sa.tenants", tenants, source, (d) => d.length === 0);
  const cacheNote = offline || fromCache ? `Showing saved data${cachedAt ? ` from ${new Date(cachedAt).toLocaleString("en-IN")}` : ""}${offline ? " — you're offline" : ""}.` : null;
  return (
    <>
      {cacheNote && <p role="status" aria-live="polite" style={{ fontSize: 12, color: "#92400e", margin: "0 0 8px" }}>{cacheNote}</p>}
      <DataTable<Row>
        columns={[
          { key: "name", label: "Tenant Name" },
          { key: "edition", label: "Edition" },
          { key: "users", label: "Users", align: "right" },
          { key: "createdDate", label: "Created" },
          { key: "status", label: "Status", cellType: "status" },
        ]}
        rows={rows} rowLinkKey="id" rowLinkPrefix="/admin/tenants/" sortable filterable filterPlaceholder="Search tenants…" pageSize={15} exportable exportFilename="tenants" emptyIcon="🏢" emptyTitle="No tenants" emptyMessage="No tenants registered."
      />
    </>
  );
}
