import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { PageHeader, StatGrid, StatCard, Card } from "@/app/_components/ds";
import { getInventoryItems } from "../_data";
import { ItemsTable } from "../ItemsTable";

export const dynamic = "force-dynamic";

export default async function InventoryItemsPage() {
  const { data: items, source } = await getInventoryItems();

  const active = items.filter((i) => i.status === "active").length;
  const consumables = items.filter((i) => i.itemType === "consumable").length;
  const tracked = items.filter((i) => i.reorderLevel > 0).length;

  return (
    <>
      <nav aria-label="Breadcrumb" className="back">
        ← <a href="/inventory">Inventory</a>
      </nav>
      <PageHeader title="Item Master" subtitle="Catalogued stock items with categories, units and reorder policy." />
      {source === "error" && <DataSourceBadge source="error" />}
      <main aria-label="Inventory item master">
        <StatGrid>
          <StatCard icon="📦" iconBg="#f1f5f9" label="Total Items" value={items.length} />
          <StatCard icon="✅" iconBg="#dcfce7" label="Active" value={active} />
          <StatCard icon="🧴" iconBg="#faf5ff" label="Consumables" value={consumables} />
          <StatCard icon="🔔" iconBg="#fef3c7" label="Reorder Tracked" value={tracked} />
        </StatGrid>
        <Card title="Items">
          <ItemsTable items={items} source={source} />
        </Card>
      </main>
    </>
  );
}
