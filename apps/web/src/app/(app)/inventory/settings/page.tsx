import { EmptyState, LoadErrorState, PageHeader } from "@/app/_components/ds";
import { INVENTORY_SETTINGS_ROLES, getSessionRoles } from "@/lib/auth/roleGuard";
import { getInventorySettings } from "../_data";
import { QcPolicyToggle } from "./QcPolicyToggle";

export const dynamic = "force-dynamic";

// GAP-INVENTORY-GOODS-RETURNS-DETAIL-04: tenant policy for the QC maker-checker rule.
// Restricted to the service's settings roles so nobody reaches a control that 403s.
export default async function InventorySettingsPage() {
  const allowed = getSessionRoles().some((r) => INVENTORY_SETTINGS_ROLES.includes(r));
  if (!allowed) {
    return (
      <>
        <PageHeader title="Inventory policy" back="/inventory" />
        <EmptyState icon="🔒" title="Not available" message="You don't have permission to change inventory policy. Contact your administrator if you think this is a mistake." />
      </>
    );
  }
  const result = await getInventorySettings();
  if (result.source === "error") {
    return (
      <>
        <PageHeader title="Inventory policy" back="/inventory" />
        <LoadErrorState result={result} area="inventory policy" backHref="/inventory" />
      </>
    );
  }
  return (
    <>
      <PageHeader title="Inventory policy" subtitle="Controls that apply to every store in your organisation." back="/inventory" />
      <QcPolicyToggle initial={result.data.qcMakerChecker} />
    </>
  );
}
