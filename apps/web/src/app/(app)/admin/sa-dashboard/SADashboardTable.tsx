"use client";
import { DataTable, StatusPill } from "@/app/_components/ds";
import { knownServiceTone } from "@/lib/admin/serviceStatus";
type Row = Record<string, unknown>;

/**
 * GAP-ADMIN-SA-DASHBOARD-02/-05: operator-facing copy (no "connect to a live
 * platform"), a failed load no longer reads as "nothing to report", and health
 * words (healthy/degraded/down...) get an explicit tone while the statuses the
 * backend emits today (active/pending/failed) keep using the shared StatusPill map.
 */
export const KPI_EMPTY_MESSAGE = "Platform KPIs are not being reported yet.";
export const KPI_ERROR_MESSAGE = "Platform KPIs could not be loaded. Refresh the page to try again.";

export function SADashboardTable({ dashboard, source = "api" }: { dashboard: Row; source?: "api" | "error" }) {
  const metrics = Array.isArray(dashboard.metrics) ? (dashboard.metrics as Row[]) : [];
  const failed = source === "error";
  return (
    <DataTable<Row>
      columns={[
        { key: "metric", label: "Metric" },
        { key: "category", label: "Category" },
        { key: "value", label: "Value", align: "right" },
        { key: "change", label: "Change" },
        {
          key: "status",
          label: "Status",
          render: (row) => (row.status == null || row.status === "" ? "—" : <StatusPill status={String(row.status)} variant={knownServiceTone(row.status)} />),
        },
      ]}
      rows={metrics}
      sortable
      filterable
      filterPlaceholder="Search KPIs…"
      pageSize={15}
      exportable
      exportFilename="sa-dashboard-kpis"
      emptyIcon="📊"
      emptyTitle={failed ? "Couldn't load metrics" : "No metrics"}
      emptyMessage={failed ? KPI_ERROR_MESSAGE : KPI_EMPTY_MESSAGE}
    />
  );
}
