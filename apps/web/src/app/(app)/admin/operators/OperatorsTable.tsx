"use client";
import { DataTable } from "@/app/_components/ds";
import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { useSeededResource } from "@/lib/sync/resource";
type Row = Record<string, unknown>;
export function OperatorsTable({ operators, source = "api" }: { operators: Row[]; source?: "api" | "error" }) {
  const { data: rows, provenance, offline, cachedAt } = useSeededResource<Row[]>("sa.operators", operators, source, (d) => d.length === 0);
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
          { key: "name", label: "Name" },
          { key: "role", label: "Role" },
          { key: "lastLogin", label: "Last Login" },
          { key: "twoFaStatus", label: "2FA", cellType: "status" },
          { key: "permissions", label: "Permissions" },
        ]}
        rows={rows} sortable filterable filterPlaceholder="Search operators…" pageSize={15} exportable exportFilename="operators" emptyIcon="👤" emptyTitle="No operators" emptyMessage="No platform operators configured."
      />
    </>
  );
}
