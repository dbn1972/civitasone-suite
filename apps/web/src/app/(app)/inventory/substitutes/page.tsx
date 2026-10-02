import { PageHeader } from "@/app/_components/ds";
import { getInventorySubstitutes } from "../_data";
import { SubstitutesTable } from "../SubstitutesTable";
import { ArrowLeft } from "lucide-react";

export const dynamic = "force-dynamic";

// GAP-INVENTORY-SUBSTITUTES-01: stats, provenance badge and the failure state live in
// SubstitutesTable so they all read ONE useSeededResource call -- this page no longer
// derives zero-filled stats from a failed fetch.
export default async function InventorySubstitutesPage() {
  const { data, source, truncated, failedCount, itemCount } = await getInventorySubstitutes();

  return (
    <>
      <nav aria-label="Breadcrumb" className="back">
        <ArrowLeft aria-hidden="true" size={14} /> <a href="/inventory">Inventory</a>
      </nav>
      <PageHeader title="Item Substitutes" subtitle="Allowed replacement items with priority order and unit conversion factors." />
      <SubstitutesTable substitutes={data}
        source={source}
        coverage={{ truncated, failedCount, itemCount }}
      />
    </>
  );
}
