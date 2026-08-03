import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { PageHeader, StatGrid, StatCard, Card } from "@/app/_components/ds";
import { getInventoryBins } from "../_data";
import { BinsTable } from "../BinsTable";

export const dynamic = "force-dynamic";

export default async function InventoryBinsPage() {
  const { data: bins, source } = await getInventoryBins();
  const active = bins.filter((b) => b.isActive).length;
  const withCapacity = bins.filter((b) => b.capacity != null && b.capacity > 0).length;

  return (
    <>
      <nav aria-label="Breadcrumb" className="back">
        ← <a href="/inventory">Inventory</a>
      </nav>
      <PageHeader title="Bins & Racks" subtitle="Physical bin and rack locations within government stores." />
      {source === "error" && <DataSourceBadge source="error" />}
      <main aria-label="Inventory bins and racks">
        <StatGrid>
          <StatCard icon="🗄️" iconBg="#f1f5f9" label="Total Bins" value={bins.length} />
          <StatCard icon="✅" iconBg="#dcfce7" label="Active" value={active} />
          <StatCard icon="📐" iconBg="#fef3c7" label="Capacity Tracked" value={withCapacity} />
        </StatGrid>
        <Card title="Bins">
          <BinsTable bins={bins} source={source} />
        </Card>
      </main>
    </>
  );
}
