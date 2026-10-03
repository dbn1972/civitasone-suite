import { requireAnyRole, getSessionRoles, getSessionTenantId } from "@/lib/auth/roleGuard";
import { ADMIN_TENANT_ROLES, ADMIN_PLATFORM_ROLES } from "@/lib/auth/adminRoles";
import { getAdminTenantDetail, getAdminSettings } from "@/app/_data/loaders";
import { SystemSettingsClient, type TenantConfigData, type SettingsLoad } from "./SystemSettingsClient";

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

// GAP-ADMIN-SETTINGS-01: the form is filled from the stored settings (GET /v1/admin/settings),
// and a failed read is its own state: nothing is editable, so Save can never overwrite what it could not read.
async function loadSettings(): Promise<SettingsLoad> {
  const res = await getAdminSettings();
  if (res.source === "error" || !res.data) return { state: "error", forbidden: res.status === 403 };
  return { state: "ready", settings: res.data };
}

export default async function AdminSystemSettingsPage() {
  requireAnyRole(ADMIN_TENANT_ROLES);
  const [tenant, settings] = await Promise.all([loadTenantConfig(), loadSettings()]);
  return <SystemSettingsClient tenant={tenant} settings={settings} />;
}
