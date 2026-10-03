import { PageHeader } from "@/app/_components/ds";
import { getInventoryBins } from "../_data";
import { BinsTable } from "../BinsTable";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { INVENTORY_BIN_MANAGE_ROLES, INVENTORY_WRITE_ROLES, getSessionRoles } from "@/lib/auth/roleGuard";

export const dynamic = "force-dynamic";

// GAP-INVENTORY-BINS-01: stats, provenance badge and the failure state live in
// BinsTable so they all read ONE useSeededResource call -- this page no longer
// derives zero-filled stats from a failed fetch.
export default async function InventoryBinsPage() {
  const { data, source } = await getInventoryBins();
  const roles = getSessionRoles();
  const canCreate = roles.some((r) => INVENTORY_WRITE_ROLES.includes(r));
  const canManage = roles.some((r) => INVENTORY_BIN_MANAGE_ROLES.includes(r));

  return (
    <>
      <nav aria-label="Breadcrumb" className="back">
        <ArrowLeft aria-hidden="true" size={14} /> <a href="/inventory">Inventory</a>
      </nav>
      <PageHeader
        title="Bins & Racks"
        subtitle="Physical bin and rack locations within government stores."
        actions={canCreate ? <Link href="/inventory/bins/new" className="btn primary">+ New bin</Link> : undefined}
      />
      <BinsTable bins={data} source={source} canManage={canManage} />
    </>
  );
}
