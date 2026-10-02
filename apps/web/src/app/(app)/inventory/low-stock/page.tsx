import { PageHeader } from "@/app/_components/ds";
import { getInventoryLowStock } from "../_data";
import { LowStockTable } from "../LowStockTable";
import { ArrowLeft } from "lucide-react";

export const dynamic = "force-dynamic";

// GAP-INVENTORY-LOW-STOCK-01: stats, provenance badge and the failure state live in
// LowStockTable so they all read ONE useSeededResource call -- this page no longer
// derives zero-filled stats from a failed fetch.
export default async function InventoryLowStockPage() {
  const { data, source } = await getInventoryLowStock();

  return (
    <>
      <nav aria-label="Breadcrumb" className="back">
        <ArrowLeft aria-hidden="true" size={14} /> <a href="/inventory">Inventory</a>
      </nav>
      <PageHeader title="Low Stock & Reorder" subtitle="Items at or below their reorder level, with suggested replenishment." />
      <LowStockTable rows={data} source={source} />
    </>
  );
}
