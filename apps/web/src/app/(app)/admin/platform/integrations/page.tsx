import { getTranslations } from "next-intl/server";
import { PLATFORM_ADMIN_ROLES } from "@/lib/auth/adminRoles";
import { AdminAccessDenied, sessionHasAnyRole } from "../../_components/AdminAccessGate";
import { PlatformIntegrationsClient } from "./_components/PlatformIntegrationsClient";

// Super-admin catalogue of the eSign / DSC / bank API / PFMS providers the platform supports.
// admin-service gates every /v1/admin/platform-integrations/providers route to
// super_admin / platform_admin; the page matches that gate before rendering any data.
export default async function PlatformIntegrationsPage() {
  const t = await getTranslations("platformIntegrations");
  if (!sessionHasAnyRole(PLATFORM_ADMIN_ROLES)) {
    return <AdminAccessDenied title={t("platform.title")} area={t("platform.title")} roles={PLATFORM_ADMIN_ROLES} />;
  }
  return <PlatformIntegrationsClient />;
}
