import { getTranslations } from "next-intl/server";
import { AdminAccessDenied, sessionHasAnyRole } from "../../../../_components/AdminAccessGate";
import { BULK_SCAN_ADMIN_ROLES } from "@/lib/auth/adminRoles";
import { getSessionUserId } from "@/lib/auth/roleGuard";
import { getBulkScanLinks, getBulkScanReview, getBulkScanReviewQueue, getBulkScanSettings } from "@/app/_data/bulkScanLoaders";
import { reviewLoadFailures } from "@/lib/bulkScan/reviewLoad";
import { allowedTargetsFromSettings } from "@/lib/bulkScan/settingsView";
import { ReviewUnavailable } from "../../../_components/ReviewUnavailable";
import { ReviewWorkspace } from "../../../_components/ReviewWorkspace";

export default async function BulkScanReviewPage({ params }: { params: { batchId: string; fileId: string } }) {
  if (!sessionHasAnyRole(BULK_SCAN_ADMIN_ROLES)) {
    const t = await getTranslations("bulkScan");
    return <AdminAccessDenied title={t("review.title")} area={t("list.area")} roles={BULK_SCAN_ADMIN_ROLES} />;
  }
  const [review, queue, awaiting, settings] = await Promise.all([
    getBulkScanReview(params.batchId, params.fileId),
    getBulkScanReviewQueue({ limit: 200 }),
    getBulkScanLinks("awaiting_approval", { limit: 200 }),
    getBulkScanSettings(),
  ]);
  if (review.source === "error" || !review.data) return <ReviewUnavailable result={review} />;
  const threshold = settings.data?.settings.reviewThreshold;
  const { queueFailed, awaitingFailed } = reviewLoadFailures(queue, awaiting);
  return (
    // key: navigating to the next file in the queue must not carry the previous file's draft state over.
    <ReviewWorkspace
      key={review.data.file.id || params.fileId}
      detail={review.data}
      queue={queue.data.items}
      awaitingLink={awaiting.data.items.find((l) => l.fileId === params.fileId) ?? null}
      currentUserId={getSessionUserId()}
      queueFailed={queueFailed}
      awaitingFailed={awaitingFailed}
      allowedLinkTargets={allowedTargetsFromSettings(settings.data)}
      {...(typeof threshold === "number" ? { reviewThreshold: threshold } : {})}
    />
  );
}
