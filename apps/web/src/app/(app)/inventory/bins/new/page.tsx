import { EmptyState, LoadErrorState, PageHeader } from "@/app/_components/ds";
import { INVENTORY_WRITE_ROLES, getSessionRoles } from "@/lib/auth/roleGuard";
import { getInventoryStoreOptions } from "../../_data";
import { NewBinForm } from "./NewBinForm";

export const dynamic = "force-dynamic";

// GAP-INVENTORY-BINS-03: create a bin (POST /v1/inventory/bins). Gated on the
// service's own write roles so a read-only user never reaches a form that 403s.
export default async function NewBinPage() {
  const allowed = getSessionRoles().some((r) => INVENTORY_WRITE_ROLES.includes(r));
  if (!allowed) {
    return (
      <>
        <PageHeader title="New bin" back="/inventory/bins" />
        <EmptyState icon="🔒" title="Not available" message="You don't have permission to add bins. Contact your administrator if you think this is a mistake." />
      </>
    );
  }
  const stores = await getInventoryStoreOptions();
  if (stores.source === "error") {
    return (
      <>
        <PageHeader title="New bin" back="/inventory/bins" />
        <LoadErrorState result={stores} area="stores" backHref="/inventory/bins" />
      </>
    );
  }
  return (
    <>
      <PageHeader title="New bin" subtitle="Add a physical bin or rack location to a store." back="/inventory/bins" />
      <NewBinForm stores={stores.data} />
    </>
  );
}
