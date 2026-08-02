import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { PageHeader, StatGrid, StatCard, Card } from "@/app/_components/ds";
import { getInventorySubstitutes } from "../_data";
import { SubstitutesTable } from "../SubstitutesTable";

export const dynamic = "force-dynamic";

export default async function InventorySubstitutesPage() {
  const { data: substitutes, source } = await getInventorySubstitutes();
  const uniqueItems = new Set(substitutes.map((s) => s.itemId)).size;
  const avgPriority =
    substitutes.length > 0
      ? substitutes.reduce((s, r) => s + (Number(r.priority) || 0), 0) / substitutes.length
      : 0;

  return (
    <>
      <nav aria-label="Breadcrumb" className="back">
        ← <a href="/inventory">Inventory</a>
      </nav>
      <PageHeader
        title="Item Substitutes"
        subtitle="Allowed replacement items with priority order and unit conversion factors."
      />
      {source === "error" && <DataSourceBadge source="error" />}
      <main aria-label="Inventory item substitutes">
        <StatGrid>
          <StatCard icon="🔁" iconBg="#faf5ff" label="Substitute Links" value={substitutes.length} />
          <StatCard icon="📦" iconBg="#f1f5f9" label="Items Covered" value={uniqueItems} />
          <StatCard icon="⭐" iconBg="#fef3c7" label="Avg Priority" value={avgPriority.toFixed(1)} />
        </StatGrid>
        <Card title="Substitutes">
          <SubstitutesTable substitutes={substitutes} source={source} />
        </Card>
      </main>
    </>
  );
}
