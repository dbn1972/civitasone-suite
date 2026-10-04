import { PageHeader } from "@/app/_components/ds";
import { getInventoryItems } from "../_data";
import { getItemLinks } from "../_dataLinks";
import { ItemsTable } from "../ItemsTable";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { INVENTORY_ITEM_LINK_ROLES, INVENTORY_WRITE_ROLES, getSessionRoles } from "@/lib/auth/roleGuard";

export const dynamic = "force-dynamic";

// GAP-INVENTORY-ITEMS-01: stats, provenance badge and the failure state live in
// ItemsTable so they all read ONE useSeededResource call -- this page no longer
// derives zero-filled stats from a failed fetch.
export default async function InventoryItemsPage() {
  const t = await getTranslations("inventoryLink");
  const [{ data, source }, linksRes] = await Promise.all([getInventoryItems(), getItemLinks()]);
  // null when the links could not be read: the table then claims nothing about link status.
  const linkedItemIds = linksRes.source === "error" ? null : linksRes.data.map((l) => l.inventoryItemId);
  const canCreate = getSessionRoles().some((r) => INVENTORY_WRITE_ROLES.includes(r));
  const canLink = getSessionRoles().some((r) => INVENTORY_ITEM_LINK_ROLES.includes(r));

  return (
    <>
      <nav aria-label="Breadcrumb" className="back">
        <ArrowLeft aria-hidden="true" size={14} /> <a href="/inventory">Inventory</a>
      </nav>
      <PageHeader
        title="Item Master"
        subtitle="Catalogued stock items with categories, units and reorder policy."
        actions={
          <>
            {canLink ? <Link href="/inventory/items/unlinked" className="btn">{t("detail.unlinkedItemsReport")}</Link> : null}
            {canCreate ? <Link href="/inventory/items/new" className="btn primary">+ New item</Link> : null}
          </>
        }
      />
      <ItemsTable items={data} source={source} linkedItemIds={linkedItemIds} />
    </>
  );
}
