import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { PageHeader, StatGrid, StatCard, Card, EmptyState } from "@/app/_components/ds";
import { getAnalyticsDataWarehouse } from "@/app/_data/loaders";
import { DataWarehouseTable } from "./DataWarehouseTable";

export default async function DataWarehousePage() {
  const { data: rows, source } = await getAnalyticsDataWarehouse();

  const total = rows.length;
  const totalRecords = rows.reduce((sum, r) => sum + (parseInt(r.records.replace(/[^0-9]/g, ""), 10) || 0), 0);
  const healthy = rows.filter((r) => r.status === "Healthy").length;

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title="Data Warehouse" subtitle="Consolidated datasets, refresh schedules and data quality metrics." back="/analytics" />
      {source === "error" && <DataSourceBadge source="error" />}
      <StatGrid>
        <StatCard icon="🗄️" iconBg="#eef2ff" label="Total Datasets" value={total} />
        <StatCard icon="📊" iconBg="#ecfdf3" label="Total Records" value={totalRecords > 0 ? totalRecords.toLocaleString("en-IN") : "0"} />
        <StatCard icon="✅" iconBg="#fffaeb" label="Healthy" value={healthy} />
        <StatCard icon="⚠️" iconBg="#fce7ee" label="Attention" value={total - healthy} />
      </StatGrid>
      <Card title="Dataset Inventory">
        {rows.length === 0 ? (
          <EmptyState icon="🗄️" title="No datasets" message="No data warehouse datasets available. Events will appear here as the analytics service processes domain events." action={<a href="/analytics/queries" className="btn primary">Run Query</a>} />
        ) : (
          <DataWarehouseTable rows={rows} source={source === "error" ? "error" : "api"} />
        )}
      </Card>
    </main>
  );
}
