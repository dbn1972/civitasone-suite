import { getTranslations } from "next-intl/server";
import { AdminAccessDenied, sessionHasAnyRole } from "../../_components/AdminAccessGate";
import { BULK_SCAN_ADMIN_ROLES } from "@/lib/auth/adminRoles";
import { getBulkScanReviewQueue } from "@/app/_data/bulkScanLoaders";
import { ReviewQueue } from "../_components/ReviewQueue";

export default async function BulkScanReviewQueuePage() {
  if (!sessionHasAnyRole(BULK_SCAN_ADMIN_ROLES)) {
    const t = await getTranslations("bulkScan");
    return <AdminAccessDenied title={t("queue.title")} area={t("list.area")} roles={BULK_SCAN_ADMIN_ROLES} />;
  }
  return <ReviewQueue result={await getBulkScanReviewQueue()} />;
}
