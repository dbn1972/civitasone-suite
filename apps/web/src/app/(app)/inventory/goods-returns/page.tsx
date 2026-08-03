import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { PageHeader, StatGrid, StatCard, Card } from "@/app/_components/ds";
import { getInventoryGoodsReturns } from "../_data";
import { GoodsReturnsTable } from "../GoodsReturnsTable";

export const dynamic = "force-dynamic";

export default async function InventoryGoodsReturnsPage() {
  const { data: returns, source } = await getInventoryGoodsReturns();
  const pendingQc = returns.filter((r) => r.qcStatus === "pending").length;
  const totalQty = returns.reduce((s, r) => s + (Number(r.qty) || 0), 0);

  return (
    <>
      <nav aria-label="Breadcrumb" className="back">
        ← <a href="/inventory">Inventory</a>
      </nav>
      <PageHeader
        title="Goods Returns"
        subtitle="Returned or rejected stock from issues, gated by QC inspection before restock or scrap."
      />
      {source === "error" && <DataSourceBadge source="error" />}
      <main aria-label="Inventory goods returns">
        <StatGrid>
          <StatCard icon="↩️" iconBg="#fee2e2" label="Returns" value={returns.length} />
          <StatCard icon="🔎" iconBg="#fef3c7" label="Pending QC" value={pendingQc} />
          <StatCard icon="🔢" iconBg="#f1f5f9" label="Total Qty" value={totalQty} />
        </StatGrid>
        <Card title="Goods Returns">
          <GoodsReturnsTable returns={returns} source={source} />
        </Card>
      </main>
    </>
  );
}
