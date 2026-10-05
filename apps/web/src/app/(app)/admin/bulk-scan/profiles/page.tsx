import { getTranslations } from "next-intl/server";
import { AdminAccessDenied, sessionHasAnyRole } from "../../_components/AdminAccessGate";
import { BULK_SCAN_ADMIN_ROLES } from "@/lib/auth/adminRoles";
import { getBulkScanProfiles, getBulkScanProviders, getBulkScanSettings } from "@/app/_data/bulkScanLoaders";
import { allowedTargetsFromSettings, docTypesFromSettings } from "@/lib/bulkScan/settingsView";
import { ProfilesManager } from "../_components/ProfilesManager";

export default async function BulkScanProfilesPage() {
  if (!sessionHasAnyRole(BULK_SCAN_ADMIN_ROLES)) {
    const t = await getTranslations("bulkScan");
    return <AdminAccessDenied title={t("profiles.title")} area={t("list.area")} roles={BULK_SCAN_ADMIN_ROLES} />;
  }
  const [profiles, providers, settings] = await Promise.all([getBulkScanProfiles(), getBulkScanProviders(), getBulkScanSettings()]);
  return <ProfilesManager profiles={profiles} providers={providers} docTypes={docTypesFromSettings(settings.data)} allowedTargets={allowedTargetsFromSettings(settings.data)} tenantSettings={settings.data?.settings} />;
}
