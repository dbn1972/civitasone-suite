"use client";
import { DataTable } from "@/app/_components/ds";
import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { useSeededResource } from "@/lib/sync/resource";
type Row = Record<string, unknown>;
export function TenantsTable({ tenants, source = "api" }: { tenants: Row[]; source?: "api" | "error" }) {
  const { data: rows, provenance, offline, cachedAt } = useSeededResource<Row[]>("sa.tenants", tenants, source, (d) => d.length === 0);
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
