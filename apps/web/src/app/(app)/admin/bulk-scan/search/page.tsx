import { getTranslations } from "next-intl/server";
import { AdminAccessDenied, sessionHasAnyRole } from "../../_components/AdminAccessGate";
import { BULK_SCAN_ADMIN_ROLES } from "@/lib/auth/adminRoles";
import { getBulkScanSettings } from "@/app/_data/bulkScanLoaders";
import { docTypesFromSettings } from "@/lib/bulkScan/settingsView";
import { SearchView } from "../_components/SearchView";

export default async function BulkScanSearchPage() {
  if (!sessionHasAnyRole(BULK_SCAN_ADMIN_ROLES)) {
    const t = await getTranslations("bulkScan");
    return <AdminAccessDenied title={t("search.title")} area={t("list.area")} roles={BULK_SCAN_ADMIN_ROLES} />;
  }
  // The document-type filter is a convenience: if settings cannot be read the search still works without it.
  const settings = await getBulkScanSettings();
  return <SearchView docTypes={docTypesFromSettings(settings.data)} />;
}
