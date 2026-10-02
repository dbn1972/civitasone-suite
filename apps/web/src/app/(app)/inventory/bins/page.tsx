import { PageHeader } from "@/app/_components/ds";
import { getInventoryBins } from "../_data";
import { BinsTable } from "../BinsTable";
import { ArrowLeft } from "lucide-react";

export const dynamic = "force-dynamic";

// GAP-INVENTORY-BINS-01: stats, provenance badge and the failure state live in
// BinsTable so they all read ONE useSeededResource call -- this page no longer
// derives zero-filled stats from a failed fetch.
export default async function InventoryBinsPage() {
  const { data, source } = await getInventoryBins();

  return (
    <>
      <nav aria-label="Breadcrumb" className="back">
        <ArrowLeft aria-hidden="true" size={14} /> <a href="/inventory">Inventory</a>
      </nav>
      <PageHeader title="Bins & Racks" subtitle="Physical bin and rack locations within government stores." />
      <BinsTable bins={data} source={source} />
    </>
  );
}
