import { getTranslations } from "next-intl/server";
import { AdminAccessDenied, sessionHasAnyRole, } from "../../_components/AdminAccessGate";
import { BULK_SCAN_ADMIN_ROLES } from "@/lib/auth/adminRoles";
import { getSessionRoles, getSessionUserId } from "@/lib/auth/roleGuard";
import { getBulkScanProviders, getBulkScanSettings } from "@/app/_data/bulkScanLoaders";
import { SettingsForm } from "../_components/SettingsForm";

export default async function BulkScanSettingsPage() {
  if (!sessionHasAnyRole(BULK_SCAN_ADMIN_ROLES)) {
    const t = await getTranslations("bulkScan");
    return <AdminAccessDenied title={t("settings.title")} area={t("list.area")} roles={BULK_SCAN_ADMIN_ROLES} />;
  }
  const [settings, providers] = await Promise.all([getBulkScanSettings(), getBulkScanProviders()]);
  return <SettingsForm settings={settings} providers={providers} currentUserId={getSessionUserId()} isSuperAdmin={getSessionRoles().includes("super_admin")} />;
}
