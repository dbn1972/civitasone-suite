import { PageHeader } from "@/app/_components/ds";
import { getInventoryItems } from "../_data";
import { ItemsTable } from "../ItemsTable";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { INVENTORY_WRITE_ROLES, getSessionRoles } from "@/lib/auth/roleGuard";

export const dynamic = "force-dynamic";

// GAP-INVENTORY-ITEMS-01: stats, provenance badge and the failure state live in
// ItemsTable so they all read ONE useSeededResource call -- this page no longer
// derives zero-filled stats from a failed fetch.
export default async function InventoryItemsPage() {
  const { data, source } = await getInventoryItems();
  const canCreate = getSessionRoles().some((r) => INVENTORY_WRITE_ROLES.includes(r));

  return (
    <>
      <nav aria-label="Breadcrumb" className="back">
        <ArrowLeft aria-hidden="true" size={14} /> <a href="/inventory">Inventory</a>
      </nav>
      <PageHeader
        title="Item Master"
        subtitle="Catalogued stock items with categories, units and reorder policy."
        actions={canCreate ? <Link href="/inventory/items/new" className="btn primary">+ New item</Link> : undefined}
      />
      <ItemsTable items={data} source={source} />
    </>
  );
}
