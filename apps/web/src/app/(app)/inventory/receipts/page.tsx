import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { PageHeader, StatGrid, StatCard, Card } from "@/app/_components/ds";
import { getInventoryLedger } from "../_data";
import { MovementsTable } from "../MovementsTable";

export const dynamic = "force-dynamic";

export default async function InventoryReceiptsPage() {
  const { data: ledger, source } = await getInventoryLedger();
  const receipts = ledger.filter((e) => e.movementType === "receipt");
  const totalQty = receipts.reduce((s, e) => s + e.qtyIn, 0);

  return (
    <>
      <nav aria-label="Breadcrumb" className="back">
        ← <a href="/inventory">Inventory</a>
      </nav>
      <PageHeader title="Goods Receipts" subtitle="Stock received into stores (GRN-in), valued at weighted-average cost." />
      {source === "error" && <DataSourceBadge source="error" />}
      <main aria-label="Inventory goods receipts">
        <StatGrid>
          <StatCard icon="📥" iconBg="#dcfce7" label="Receipt Lines" value={receipts.length} />
          <StatCard icon="🔢" iconBg="#f1f5f9" label="Total Qty Received" value={totalQty} />
        </StatGrid>
        <Card title="Receipts">
          <MovementsTable entries={ledger} kind="receipt" source={source} />
        </Card>
      </main>
    </>
  );
}
