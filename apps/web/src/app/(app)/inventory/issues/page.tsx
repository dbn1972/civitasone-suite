import { PageHeader } from "@/app/_components/ds";
import { getInventoryLedger } from "../_data";
import { MovementsTable } from "../MovementsTable";
import { ArrowLeft } from "lucide-react";

export const dynamic = "force-dynamic";

// GAP-INVENTORY-ISSUES-01: stats, provenance badge and the failure state live in
// MovementsTable so they all read ONE useSeededResource call -- this page no longer
// derives zero-filled stats from a failed fetch.
export default async function InventoryIssuesPage() {
  const { data, source } = await getInventoryLedger({ movementType: "issue" });

  return (
    <>
      <nav aria-label="Breadcrumb" className="back">
        <ArrowLeft aria-hidden="true" size={14} /> <a href="/inventory">Inventory</a>
      </nav>
      <PageHeader title="Stock Issues" subtitle="Stock issued or consumed from stores (latest movements first)." />
      <MovementsTable entries={data} kind="issue" source={source} />
    </>
  );
}
