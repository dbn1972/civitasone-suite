"use client";
import { DataTable, StatGrid, StatCard, LoadErrorState, Card } from "@/app/_components/ds";
import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { useSeededResource } from "@/lib/sync/resource";
import { countEditions, type EditionRow } from "@/lib/admin/monitoring";

type Row = EditionRow;
/** Column keys are checked against the row type: renaming a field breaks tsc here. */
type ColumnKey = "name" | "modulesIncluded" | "pricing" | "tenants" | "status";

const COLUMNS: { key: ColumnKey; label: string; align?: "center" | "right"; cellType?: "status" }[] = [
  { key: "name", label: "Edition" },
  { key: "modulesIncluded", label: "Modules", align: "center" },
  { key: "pricing", label: "Pricing" },
  { key: "tenants", label: "Tenants", align: "right" },
  { key: "status", label: "Status", cellType: "status" },
];

/**
 * GAP-ADMIN-EDITIONS-02/-03/-04: the summary cards, the table and the failure
 * state share ONE useSeededResource call (see ApiMonitoringTable for the
 * rationale). "Deprecated" counts only deprecated editions; drafts and other
 * statuses are reported separately instead of being folded into it.
 */
export function EditionsTable({
  editions,
  source = "api",
  status,
  errorMessage,
}: {
  editions: Row[];
  source?: "api" | "error";
  status?: number;
  errorMessage?: string;
}) {
  const { data: rows, provenance, offline, cachedAt } = useSeededResource<Row[]>("sa.editions", editions, source, (d) => d.length === 0);
  const noData = provenance === "error-no-data";
  const c = countEditions(rows);
  const stat = (n: number): number | null => (noData ? null : n);

  return (
    <>
      <DataSourceBadge provenance={provenance ?? "live"} cachedAt={cachedAt} offline={offline} />
      <StatGrid>
        <StatCard icon="📦" iconBg="#eef2ff" label="Total Editions" value={stat(c.total)} />
        <StatCard icon="✅" iconBg="#ecfdf3" label="Active" value={stat(c.active)} />
        <StatCard icon="🏢" iconBg="#fffaeb" label="Total Tenants" value={stat(c.tenants)} />
        <StatCard icon="🗄️" iconBg="#eff6ff" label="Deprecated" value={stat(c.deprecated)} />
        <StatCard icon="📝" iconBg="#f1f5f9" label="Draft / other" value={stat(c.other)} />
      </StatGrid>
      <Card title="Editions">
        {noData ? (
          <LoadErrorState result={{ status, errorMessage }} area="editions" backHref="/admin" />
        ) : (
          <DataTable<Row>
            columns={COLUMNS}
            rows={rows}
            rowHref={() => "/admin/entitlements"}
            identifyingColumnKey="name"
            sortable
            filterable
            filterPlaceholder="Search editions…"
            pageSize={15}
            exportable
            exportFilename="editions"
            emptyIcon="📦"
            emptyTitle="No editions"
            emptyMessage="No platform editions configured."
          />
        )}
      </Card>
    </>
  );
}
