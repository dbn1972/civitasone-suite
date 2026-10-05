import { getTranslations } from "next-intl/server";
import { AdminAccessDenied, sessionHasAnyRole } from "../_components/AdminAccessGate";
import { BULK_SCAN_ADMIN_ROLES } from "@/lib/auth/adminRoles";
import { getBulkScanBatches } from "@/app/_data/bulkScanLoaders";
import { BatchesList } from "./_components/BatchesList";

// GAP-ADMIN-BULK-SCAN-02: bulk document scan + OCR. Admin > Bulk scan lists batches with live progress; the other screens
// (new batch, batch detail, review queue/workspace, link approvals, search, settings, profiles) hang off it.
export default async function AdminBulkScanPage() {
  // Role gate before any loader runs: an unauthorised caller sees "Access restricted" and no data is fetched.
  if (!sessionHasAnyRole(BULK_SCAN_ADMIN_ROLES)) {
    const t = await getTranslations("bulkScan");
    return <AdminAccessDenied title={t("list.title")} area={t("list.area")} roles={BULK_SCAN_ADMIN_ROLES} />;
  }
  const result = await getBulkScanBatches();
  return <BatchesList result={result} />;
}
