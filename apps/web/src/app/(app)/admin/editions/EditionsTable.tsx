"use client";
import { DataTable } from "@/app/_components/ds";
import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { useSeededResource } from "@/lib/sync/resource";
type Row = Record<string, unknown>;
export function EditionsTable({ editions, source = "api" }: { editions: Row[]; source?: "api" | "error" }) {
  const { data: rows, provenance, offline, cachedAt } = useSeededResource<Row[]>("sa.editions", editions, source, (d) => d.length === 0);
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
