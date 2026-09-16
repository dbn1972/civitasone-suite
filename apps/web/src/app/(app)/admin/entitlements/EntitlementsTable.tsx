"use client";
import { DataTable } from "@/app/_components/ds";
import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { useSeededResource } from "@/lib/sync/resource";
type Row = Record<string, unknown>;
export function EntitlementsTable({ entitlements, source = "api" }: { entitlements: Row[]; source?: "api" | "error" }) {
  const { data: rows, provenance, offline, cachedAt } = useSeededResource<Row[]>("sa.entitlements", entitlements, source, (d) => d.length === 0);
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
