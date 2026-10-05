import { getTranslations } from "next-intl/server";
import { AdminAccessDenied, sessionHasAnyRole } from "../../_components/AdminAccessGate";
import { BULK_SCAN_ADMIN_ROLES } from "@/lib/auth/adminRoles";
import { getSessionUserId } from "@/lib/auth/roleGuard";
import { getBulkScanLinks } from "@/app/_data/bulkScanLoaders";
import { LINK_STATES } from "@/lib/bulkScan/types";
import { LinksApprovals } from "../_components/LinksApprovals";

export default async function BulkScanLinksPage({ searchParams }: { searchParams?: { state?: string } }) {
  if (!sessionHasAnyRole(BULK_SCAN_ADMIN_ROLES)) {
    const t = await getTranslations("bulkScan");
    return <AdminAccessDenied title={t("links.title")} area={t("list.area")} roles={BULK_SCAN_ADMIN_ROLES} />;
  }
  const requested = searchParams?.state ?? "";
  const state = (LINK_STATES as readonly string[]).includes(requested) ? requested : "awaiting_approval";
  return <LinksApprovals result={await getBulkScanLinks(state)} state={state} currentUserId={getSessionUserId()} />;
}
