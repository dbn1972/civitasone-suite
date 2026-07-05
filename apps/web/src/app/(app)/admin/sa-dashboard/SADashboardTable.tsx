"use client";
import { DataTable } from "@/app/_components/ds";
type Row = Record<string, unknown>;
export function SADashboardTable({ dashboard, source = "api" }: { dashboard: Row; source?: "api" | "error" }) {
  const metrics = Array.isArray(dashboard.metrics) ? (dashboard.metrics as Row[]) : [];
  return (
    <DataTable<Row>
      columns={[
        { key: "metric", label: "Metric" },
        { key: "category", label: "Category" },
        { key: "value", label: "Value", align: "right" },
        { key: "change", label: "Change" },
        { key: "status", label: "Status", cellType: "status" },
      ]}
      rows={metrics}
      sortable
      filterable
      filterPlaceholder="Search KPIs…"
      pageSize={15}
      exportable
      exportFilename="sa-dashboard-kpis"
      emptyIcon="📊"
      emptyTitle="No metrics"
      emptyMessage="Dashboard metrics not available. Connect to a live platform."
    />
  );
}
