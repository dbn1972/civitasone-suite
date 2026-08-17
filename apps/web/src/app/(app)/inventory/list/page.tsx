import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { PageHeader, StatGrid, StatCard, Card, DataTable } from "@/app/_components/ds";
import { formatMoney, formatIndianDate } from "@/lib/formatters";
import { getStockItems } from "../../../_data/loaders";
import { getInventoryCycleCounts, type InventoryCycleCountRow } from "../_data";
import { InventoryStockListClient } from "./InventoryStockListClient";

export const dynamic = "force-dynamic";

const CYCLE_COUNT_COLUMNS = [
  { key: "countedAt" as const, label: "Counted", render: (r: InventoryCycleCountRow) => formatIndianDate(r.countedAt) },
  { key: "itemId" as const, label: "Item" },
  { key: "warehouseId" as const, label: "Warehouse" },
  { key: "systemQty" as const, label: "System qty", align: "right" as const },
  { key: "physicalQty" as const, label: "Physical qty", align: "right" as const },
  { key: "variance" as const, label: "Variance", align: "right" as const },
  { key: "reasonCode" as const, label: "Reason" },
  { key: "status" as const, label: "Status", cellType: "status" as const },
];

export default async function InventoryListPage() {
  const [{ data: items, source }, { data: pendingCycleCounts }] = await Promise.all([
    getStockItems(),
    getInventoryCycleCounts("pending_approval"),
  ]);

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

        {pendingCycleCounts.length > 0 ? (
          <Card title="Cycle counts pending approval">
            <DataTable<InventoryCycleCountRow>
              columns={CYCLE_COUNT_COLUMNS}
              rows={pendingCycleCounts}
              rowLinkPrefix="/inventory/cycle-counts/"
              rowLinkKey="id"
              pageSize={15}
            />
          </Card>
        ) : null}

        <InventoryStockListClient items={items} />
      </main>
    </>
  );
}
