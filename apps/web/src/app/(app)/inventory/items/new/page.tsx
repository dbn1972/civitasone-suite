import { EmptyState, PageHeader } from "@/app/_components/ds";
import { INVENTORY_WRITE_ROLES, getSessionRoles } from "@/lib/auth/roleGuard";
import { getInventoryNamedList } from "../../_data";
import { NewItemForm } from "./NewItemForm";

export const dynamic = "force-dynamic";

// GAP-INVENTORY-ITEMS-03: create an item-master entry (POST /v1/inventory/items).
// The legacy stock/items/new form is unreachable (/stock/* redirects to /inventory/*)
// and writes the separate stock-service master, so this is the inventory one.
export default async function NewItemPage() {
  const allowed = getSessionRoles().some((r) => INVENTORY_WRITE_ROLES.includes(r));
  if (!allowed) {
    return (
      <>
        <PageHeader title="New item" back="/inventory/items" />
        <EmptyState icon="🔒" title="Not available" message="You don't have permission to add items. Contact your administrator if you think this is a mistake." />
      </>
    );
  }
  const [categories, uoms] = await Promise.all([
    getInventoryNamedList("categories"),
    getInventoryNamedList("uoms"),
  ]);
  return (
    <>
      <PageHeader title="New item" subtitle="Add an item to the inventory item master." back="/inventory/items" />
      <NewItemForm categories={categories.data} uoms={uoms.data} />
    </>
  );
}
