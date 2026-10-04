import { getTranslations } from "next-intl/server";
import { ADMIN_TENANT_ROLES, INTEGRATION_ADMIN_ROLES } from "@/lib/auth/adminRoles";
import { getSessionRoles, getSessionUserId } from "@/lib/auth/roleGuard";
import { AdminAccessDenied, sessionHasAnyRole } from "../../_components/AdminAccessGate";
import { TenantIntegrationsClient } from "./_components/TenantIntegrationsClient";

// e-Sign, DSC, bank API and PFMS: the tenant's schema-driven configuration of the providers the
// platform supports. admin-service gates every /v1/admin/platform-integrations/tenant route to
// tenant_admin, finance_admin, payroll_admin and the platform roles; the page matches that gate.
// Only tenant_admin-level roles may change the production-approval policy.
export default async function TenantPlatformIntegrationsPage() {
  const t = await getTranslations("platformIntegrations");
  if (!sessionHasAnyRole(INTEGRATION_ADMIN_ROLES)) {
    return <AdminAccessDenied title={t("tenant.title")} area={t("tenant.title")} roles={INTEGRATION_ADMIN_ROLES} />;
  }
  const canEditPolicy = getSessionRoles().some((r) => ADMIN_TENANT_ROLES.includes(r));
  return <TenantIntegrationsClient actorId={getSessionUserId()} canEditPolicy={canEditPolicy} />;
}
