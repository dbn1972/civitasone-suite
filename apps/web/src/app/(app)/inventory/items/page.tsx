import { PageHeader } from "@/app/_components/ds";
import { getInventoryItems } from "../_data";
import { ItemsTable } from "../ItemsTable";
import { ArrowLeft } from "lucide-react";

export const dynamic = "force-dynamic";

// GAP-INVENTORY-ITEMS-01: stats, provenance badge and the failure state live in
// ItemsTable so they all read ONE useSeededResource call -- this page no longer
// derives zero-filled stats from a failed fetch.
export default async function InventoryItemsPage() {
  const { data, source } = await getInventoryItems();

  return (
    <>
      <nav aria-label="Breadcrumb" className="back">
        <ArrowLeft aria-hidden="true" size={14} /> <a href="/inventory">Inventory</a>
      </nav>
      <PageHeader title="Item Master" subtitle="Catalogued stock items with categories, units and reorder policy." />
      <ItemsTable items={data} source={source} />
    </>
  );
}
