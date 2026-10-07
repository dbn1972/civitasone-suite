import { PageHeader, StatGrid, StatCard, Card, EmptyState, RefreshErrorState } from "@/app/_components/ds";
import { getAnalyticsDataWarehouse } from "@/app/_data/loaders";
import { DataWarehouseTable } from "./DataWarehouseTable";
import { sumRecordCounts } from "./records";
import { toResourceState } from "@/app/_data/useResource";
import { toHumanError } from "@/lib/messages";

function isHealthy(status: string): boolean {
  // GAP-ANALYTICS-DATA-WAREHOUSE-03: compare case-insensitively so "healthy"
  // is not miscounted as needing attention.
  return status.trim().toLowerCase() === "healthy";
}

export default async function DataWarehousePage() {
  const result = await getAnalyticsDataWarehouse();
  const { data: rows, source } = result;
  const resource = toResourceState(result);
  const errored = resource.status === "error";

  const total = errored ? null : rows.length;
  // GAP-ANALYTICS-DATA-WAREHOUSE-01: parse strictly; show "—" if any row's
  // count is unreadable rather than a misleadingly-low fabricated total.
  const recordTotal = errored ? null : sumRecordCounts(rows.map((r) => r.records));
  const healthy = errored ? null : rows.filter((r) => isHealthy(r.status)).length;
  const attention = errored ? null : rows.length - (healthy ?? 0);

  const totalRecordsDisplay =
    recordTotal === null || recordTotal.partial
      ? "—"
      : recordTotal.total.toLocaleString("en-IN");

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      {/* GAP-ANALYTICS-DATA-WAREHOUSE-02: subtitle no longer promises "refresh
          schedules" — the table shows only Last Refresh, not a schedule or
          next-run. */}
      <PageHeader title="Data Warehouse" subtitle="Consolidated datasets and data quality metrics." back="/analytics" />
      <StatGrid>
        <StatCard icon="🗄" tone="info" label="Total Datasets" value={total ?? "—"} />
        <StatCard
          icon="📊"
          tone="good"
          label="Total Records"
          hint={recordTotal?.partial ? "Some datasets report a non-numeric record count, so a total can't be computed." : undefined}
          value={totalRecordsDisplay}
        />
        <StatCard icon="✅" tone="good" label="Healthy" value={healthy ?? "—"} />
        <StatCard icon="⚠" tone="warn" label="Attention" value={attention ?? "—"} />
      </StatGrid>
      <Card title="Dataset Inventory">
        {errored ? (
          <div className="pad">
            <RefreshErrorState error={toHumanError("load", { area: "data warehouse datasets" })} backHref="/analytics" />
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            icon="🗄"
            title="No datasets"
            message="No data warehouse datasets available yet. Datasets appear here as the analytics service processes domain events."
          />
        ) : (
          <DataWarehouseTable rows={rows} source={source === "error" ? "error" : "api"} />
        )}
      </Card>
    </div>
  );
}
