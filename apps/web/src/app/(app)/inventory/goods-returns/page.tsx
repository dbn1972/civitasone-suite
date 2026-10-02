import { PageHeader } from "@/app/_components/ds";
import { getInventoryGoodsReturns } from "../_data";
import { GoodsReturnsTable } from "../GoodsReturnsTable";
import { ArrowLeft } from "lucide-react";

export const dynamic = "force-dynamic";

// GAP-INVENTORY-GOODS-RETURNS-01: stats, provenance badge and the failure state live in
// GoodsReturnsTable so they all read ONE useSeededResource call -- this page no longer
// derives zero-filled stats from a failed fetch.
export default async function InventoryGoodsReturnsPage() {
  const { data, source } = await getInventoryGoodsReturns();

  return (
    <>
      <nav aria-label="Breadcrumb" className="back">
        <ArrowLeft aria-hidden="true" size={14} /> <a href="/inventory">Inventory</a>
      </nav>
      <PageHeader title="Goods Returns" subtitle="Returned or rejected stock from issues, gated by QC inspection before restock or scrap." />
      <GoodsReturnsTable returns={data} source={source} />
    </>
  );
}
