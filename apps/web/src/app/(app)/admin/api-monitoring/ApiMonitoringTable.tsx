"use client";
import { useEffect, useState } from "react";
import { DataTable, StatGrid, StatCard, LoadErrorState, Card } from "@/app/_components/ds";
import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { useSeededResource } from "@/lib/sync/resource";
import { formatIndianDateTime as formatDateTimeIST } from "@/lib/formatters";
import { countApiStatuses, errorRateView, formatLatencyMs, isSnapshotStale, newestCheckedAt, type ApiEndpointRow } from "@/lib/admin/monitoring";

type Row = ApiEndpointRow;
/** Column keys are checked against the row type: renaming a field breaks tsc here. */
type ColumnKey = "service" | "endpoint" | "p95Latency" | "errorRate" | "requestsPerMin" | "status" | "checkedAt";

const COLUMNS: {
  key: ColumnKey; label: string; align?: "right"; cellType?: "status";
  render?: (r: Row) => React.ReactNode; csv?: (r: Row) => string;
}[] = [
  { key: "service", label: "Service" },
  { key: "endpoint", label: "Endpoint" },
  // GAP-ADMIN-API-MONITORING-06: p95 is milliseconds, error rate is a percentage with a unit and a
  // text + colour severity cue; both fall back to an em dash rather than a guessed number.
  { key: "p95Latency", label: "p95", align: "right", render: (r) => formatLatencyMs(r.p95Latency), csv: (r) => formatLatencyMs(r.p95Latency) },
  {
    key: "errorRate", label: "Error Rate",
    render: (r) => {
      const v = errorRateView(r.errorRate);
      return <span className={`pill ${v.tone}`} aria-label={v.label}>{v.text}</span>;
    },
    csv: (r) => errorRateView(r.errorRate).text,
  },
  { key: "requestsPerMin", label: "Req/min", align: "right" },
  { key: "status", label: "Status", cellType: "status" },
  {
    key: "checkedAt", label: "Last checked",
    render: (r) => (r.checkedAt ? formatDateTimeIST(r.checkedAt) : "Not reported"),
    csv: (r) => (r.checkedAt ? formatDateTimeIST(r.checkedAt) : ""),
  },
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
  // GAP-ADMIN-API-MONITORING-06: say how fresh the snapshot is, in words, so a stale one is not mistaken for live.
  const checkedAt = newestCheckedAt(rows);
  const [nowMs, setNowMs] = useState<number | null>(null);
  useEffect(() => { setNowMs(Date.now()); }, [rows]);
  const stale = nowMs !== null && isSnapshotStale(checkedAt, nowMs);

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
        {!noData && (
          <p role="status" style={{ margin: "0 0 8px", fontSize: 12.5, color: stale ? "var(--bad)" : "var(--mut)" }}>
            {checkedAt
              ? `Data as of ${formatDateTimeIST(checkedAt)}${stale ? " — this snapshot is more than 5 minutes old and may not reflect the current state." : "."}`
              : "The monitoring source did not report when this data was measured, so it cannot be confirmed as current."}
          </p>
        )}
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
            emptyMessage="No API traffic was recorded in the last 15 minutes. Rows appear here as soon as requests pass through the gateway."
          />
        )}
      </Card>
    </>
  );
}
