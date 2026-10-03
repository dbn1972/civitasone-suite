"use client";
import { DataTable, StatGrid, StatCard, LoadErrorState, Card } from "@/app/_components/ds";
import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { useSeededResource } from "@/lib/sync/resource";
import { countApiStatuses, type ApiEndpointRow } from "@/lib/admin/monitoring";

type Row = ApiEndpointRow;
/** Column keys are checked against the row type: renaming a field breaks tsc here. */
type ColumnKey = "service" | "endpoint" | "p95Latency" | "errorRate" | "requestsPerMin" | "status";

const COLUMNS: { key: ColumnKey; label: string; align?: "right"; cellType?: "status" }[] = [
  { key: "service", label: "Service" },
  { key: "endpoint", label: "Endpoint" },
  { key: "p95Latency", label: "p95 (ms)", align: "right" },
  { key: "errorRate", label: "Error Rate" },
  { key: "requestsPerMin", label: "Req/min", align: "right" },
  { key: "status", label: "Status", cellType: "status" },
];

/**
 * GAP-ADMIN-API-MONITORING-02/-03: the summary cards, the table and the
 * failure state all read ONE useSeededResource call. Before, the cards were
 * computed on the server from the raw loader result while the table read the
 * offline cache, so "Showing saved data" sat above a populated table and four
 * zero cards; and a failed load looked like an empty, all-zero dashboard.
 */
export function ApiMonitoringTable({
  endpoints,
  source = "api",
  status,
  errorMessage,
}: {
  endpoints: Row[];
  source?: "api" | "error";
  status?: number;
  errorMessage?: string;
}) {
  const { data: rows, provenance, offline, cachedAt } = useSeededResource<Row[]>("sa.api-monitoring", endpoints, source, (d) => d.length === 0);
  const noData = provenance === "error-no-data";
  const c = countApiStatuses(rows);
  const stat = (n: number): number | null => (noData ? null : n);

  return (
    <>
      <DataSourceBadge provenance={provenance ?? "live"} cachedAt={cachedAt} offline={offline} />
      <StatGrid>
        <StatCard icon="🔌" iconBg="#eef2ff" label="Endpoints" value={stat(c.endpoints)} />
        <StatCard icon="✅" iconBg="#ecfdf3" label="Healthy" value={stat(c.healthy)} />
        <StatCard icon="⚠️" iconBg="#fffaeb" label="Degraded" value={stat(c.degraded)} />
        <StatCard icon="❌" iconBg="#fce7ee" label="Down" value={stat(c.down)} />
        <StatCard icon="❔" iconBg="#f1f5f9" label="Unknown / other" value={stat(c.other)} />
      </StatGrid>
      <Card title="API Endpoints">
        {noData ? (
          <LoadErrorState
            result={{ status, errorMessage }}
            area="API monitoring"
            backHref="/admin"
          />
        ) : (
          <DataTable<Row>
            columns={COLUMNS}
            rows={rows}
            sortable
            filterable
            filterPlaceholder="Search APIs…"
            pageSize={20}
            exportable
            exportFilename="api-monitoring"
            emptyIcon="🔌"
            emptyTitle="No API data"
            emptyMessage="API monitoring data not available."
          />
        )}
      </Card>
    </>
  );
}
