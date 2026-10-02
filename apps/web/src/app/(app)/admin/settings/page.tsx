import { requireAnyRole, getSessionRoles, getSessionTenantId } from "@/lib/auth/roleGuard";
import { ADMIN_TENANT_ROLES, ADMIN_PLATFORM_ROLES } from "@/lib/auth/adminRoles";
import { getAdminTenantDetail } from "@/app/_data/loaders";
import { SystemSettingsClient, type TenantConfigData } from "./SystemSettingsClient";

// GAP-ADMIN-SETTINGS-02: the Tenant Config tab used to render hard-coded
// "Ministry of Finance / finmin.nic.in / finmin-prod" for every visitor. It is
// now shown only to platform_admin/super_admin and filled from the real tenant
// record (GET /v1/admin/tenants/:id, itself super_admin/platform_admin-gated).
async function loadTenantConfig(): Promise<TenantConfigData> {
  const roles = getSessionRoles();
  if (!ADMIN_PLATFORM_ROLES.some((r) => roles.includes(r))) return { state: "hidden" };
  const tenantId = getSessionTenantId();
  if (!tenantId) return { state: "error", forbidden: false };
  const res = await getAdminTenantDetail(tenantId);
  if (res.source === "error" || !res.data) return { state: "error", forbidden: res.status === 403 };
  const d = res.data;
  return { state: "ready", name: String(d.name ?? ""), domain: String(d.domain ?? ""), edition: String(d.edition ?? ""), status: String(d.status ?? ""), region: String(d.region ?? "") };
}

export default async function AdminSystemSettingsPage() {
  requireAnyRole(ADMIN_TENANT_ROLES);
  return <SystemSettingsClient tenant={await loadTenantConfig()} />;
}
