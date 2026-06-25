import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { PageHeader, StatGrid, StatCard, Card } from "@/app/_components/ds";
import { getInventoryLowStock } from "../_data";
import { LowStockTable } from "../LowStockTable";

export const dynamic = "force-dynamic";

export default async function InventoryLowStockPage() {
  const { data: rows, source } = await getInventoryLowStock();
  const totalSuggested = rows.reduce((s, r) => s + r.suggestedReorderQty, 0);

  return (
    <>
      <nav aria-label="Breadcrumb" className="back">
        ← <a href="/inventory">Inventory</a>
      </nav>
      <PageHeader title="Low Stock & Reorder" subtitle="Items at or below their reorder level, with suggested replenishment." />
      {source === "error" && <DataSourceBadge source="error" />}
      <main aria-label="Inventory low stock and reorder">
        <StatGrid>
          <StatCard icon="⚠️" iconBg="#fee2e2" label="Items Low" value={rows.length} />
          <StatCard icon="🛒" iconBg="#fef3c7" label="Total Suggested Reorder" value={totalSuggested} />
        </StatGrid>
        <Card title="Low Stock Items">
          <LowStockTable rows={rows} source={source} />
        </Card>
      </main>
    </>
  );
}
