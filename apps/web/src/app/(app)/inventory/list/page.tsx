import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { PageHeader, StatGrid, StatCard } from "@/app/_components/ds";
import { formatMoney } from "@/lib/formatters";
import { getStockItems } from "../../../_data/loaders";
import { InventoryStockListClient } from "./InventoryStockListClient";

export const dynamic = "force-dynamic";

export default async function InventoryListPage() {
  const { data: items, source } = await getStockItems();

  const lowStockCount = items.filter((i) => i.isLowStock).length;
  const totalValue = items.reduce((sum, i) => sum + i.totalValue, 0);

  return (
    <>
      <nav aria-label="Breadcrumb" className="back">
        ← <a href="/inventory">Inventory</a>
      </nav>
      <PageHeader
        title="Stock Items"
        subtitle="All SKUs shared with the inventory module and their current stock levels."
      />
      {source === "error" && <DataSourceBadge source="error" />}
      <main aria-label="Inventory stock items">
        <StatGrid>
          <StatCard icon="📦" iconBg="#f1f5f9" label="Total SKUs" value={items.length} />
          <StatCard icon="⚠️" iconBg="#fee2e2" label="Low Stock" value={lowStockCount} />
          <StatCard icon="💰" iconBg="#eff6ff" label="Stock Value" value={formatMoney(totalValue)} />
        </StatGrid>
        <InventoryStockListClient items={items} />
      </main>
    </>
  );
}
