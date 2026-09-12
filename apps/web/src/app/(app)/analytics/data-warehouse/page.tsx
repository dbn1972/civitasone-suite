import { PageHeader, StatGrid, StatCard, Card, EmptyState, RefreshErrorState } from "@/app/_components/ds";
import { getAnalyticsDataWarehouse } from "@/app/_data/loaders";
import { DataWarehouseTable } from "./DataWarehouseTable";
import { useResource } from "@/app/_data/useResource";
import { toHumanError } from "@/lib/messages";

export default async function DataWarehousePage() {
  const result = await getAnalyticsDataWarehouse();
  const { data: rows, source } = result;
  const resource = useResource(result);
  const errored = resource.status === "error";

  const total = errored ? null : rows.length;
  const totalRecords = errored
    ? null
    : rows.reduce((sum, r) => sum + (parseInt(r.records.replace(/[^0-9]/g, ""), 10) || 0), 0);
  const healthy = errored ? null : rows.filter((r) => r.status === "Healthy").length;
  const attention = errored ? null : rows.length - rows.filter((r) => r.status === "Healthy").length;

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title="Data Warehouse" subtitle="Consolidated datasets, refresh schedules and data quality metrics." back="/analytics" />
      <StatGrid>
        <StatCard icon="🗄️" iconBg="#eef2ff" label="Total Datasets" value={total ?? "—"} />
        <StatCard icon="📊" iconBg="#ecfdf3" label="Total Records" value={totalRecords === null ? "—" : totalRecords > 0 ? totalRecords.toLocaleString("en-IN") : "0"} />
        <StatCard icon="✅" iconBg="#fffaeb" label="Healthy" value={healthy ?? "—"} />
        <StatCard icon="⚠️" iconBg="#fce7ee" label="Attention" value={attention ?? "—"} />
      </StatGrid>
      <Card title="Dataset Inventory">
        {errored ? (
          <div className="pad">
            <RefreshErrorState error={toHumanError("load", { area: "data warehouse datasets" })} backHref="/analytics" />
          </div>
        ) : rows.length === 0 ? (
          <EmptyState icon="🗄️" title="No datasets" message="No data warehouse datasets available. Events will appear here as the analytics service processes domain events." action={<a href="/analytics/queries" className="btn primary">Run Query</a>} />
        ) : (
          <DataWarehouseTable rows={rows} source={source === "error" ? "error" : "api"} />
        )}
      </Card>
    </main>
  );
}
