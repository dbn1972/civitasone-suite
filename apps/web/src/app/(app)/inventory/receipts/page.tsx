import { PageHeader } from "@/app/_components/ds";
import { getInventoryLedger } from "../_data";
import { MovementsTable } from "../MovementsTable";
import { ArrowLeft } from "lucide-react";

export const dynamic = "force-dynamic";

// GAP-INVENTORY-RECEIPTS-01: stats, provenance badge and the failure state live in
// MovementsTable so they all read ONE useSeededResource call -- this page no longer
// derives zero-filled stats from a failed fetch.
export default async function InventoryReceiptsPage() {
  const { data, source } = await getInventoryLedger();

  return (
    <>
      <nav aria-label="Breadcrumb" className="back">
        <ArrowLeft aria-hidden="true" size={14} /> <a href="/inventory">Inventory</a>
      </nav>
      <PageHeader title="Goods Receipts" subtitle="Stock received into stores (GRN-in), valued at weighted-average cost." />
      <MovementsTable entries={data} kind="receipt" source={source} />
    </>
  );
}
