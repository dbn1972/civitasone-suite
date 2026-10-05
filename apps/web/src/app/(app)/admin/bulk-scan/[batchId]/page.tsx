import { getTranslations } from "next-intl/server";
import { AdminAccessDenied, sessionHasAnyRole } from "../../_components/AdminAccessGate";
import { BULK_SCAN_ADMIN_ROLES } from "@/lib/auth/adminRoles";
import { getBulkScanBatch, getBulkScanBatchFiles } from "@/app/_data/bulkScanLoaders";
import { BatchDetail } from "../_components/BatchDetail";

// Stable deep link (the HR employee card links here): /admin/bulk-scan/<batchId>.
export default async function BulkScanBatchPage({ params }: { params: { batchId: string } }) {
  if (!sessionHasAnyRole(BULK_SCAN_ADMIN_ROLES)) {
    const t = await getTranslations("bulkScan");
    return <AdminAccessDenied title={t("detail.title")} area={t("list.area")} roles={BULK_SCAN_ADMIN_ROLES} />;
  }
  const [batch, files] = await Promise.all([getBulkScanBatch(params.batchId), getBulkScanBatchFiles(params.batchId)]);
  return <BatchDetail batchResult={batch} filesResult={files} />;
}
