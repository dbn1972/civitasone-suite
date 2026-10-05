import type { NavTile } from "@civitasone/types";
import {
  ADMIN_PLATFORM_ROLES,
  ADMIN_TENANT_ROLES,
  API_CATALOGUE_ROLES,
  BILLING_INVOICE_READER_ROLES,
  BULK_SCAN_ADMIN_ROLES,
  AUDIT_LOG_VIEW_ROLES,
  DEVICE_ADMIN_ROLES,
  INTEGRATION_ADMIN_ROLES,
} from "@/lib/auth/adminRoles";

/**
 * Single source for the /admin hub tiles (GAP-ADMIN-HOME-02/03/04/05).
 *
 * `roles` mirrors the destination page's own gate, so a tile is shown only to a
 * caller the page will admit (nav visibility is never the access control; the
 * route and the backing service still enforce it). Titles and descriptions come
 * from the `admin.tiles.<id>` message catalogue; `section` from `admin.sections`.
 * Tiles are listed grouped by section because LinkTiles groups consecutive tiles.
 */
export type AdminTileDef = {
  id: string;
  href: string;
  icon: string;
  section: "platform" | "billing" | "connectivity" | "operations" | "access" | "tenant";
  roles: readonly string[];
};

export const ADMIN_TILES: readonly AdminTileDef[] = [
  { id: "saDashboard", href: "/admin/sa-dashboard", icon: "📊", section: "platform", roles: ADMIN_PLATFORM_ROLES },
  { id: "tenants", href: "/admin/tenants", icon: "🏢", section: "platform", roles: ADMIN_PLATFORM_ROLES },
  { id: "tenantProvision", href: "/admin/tenant-provision", icon: "🧱", section: "platform", roles: ADMIN_PLATFORM_ROLES },
  { id: "onboarding", href: "/admin/onboarding", icon: "📥", section: "platform", roles: ADMIN_PLATFORM_ROLES },
  { id: "metering", href: "/admin/metering", icon: "📈", section: "billing", roles: ADMIN_PLATFORM_ROLES },
  { id: "invoices", href: "/admin/invoices", icon: "🧾", section: "billing", roles: BILLING_INVOICE_READER_ROLES },
  { id: "editions", href: "/admin/editions", icon: "📦", section: "billing", roles: ADMIN_PLATFORM_ROLES },
  { id: "entitlements", href: "/admin/entitlements", icon: "🔑", section: "billing", roles: ADMIN_PLATFORM_ROLES },
  { id: "featureFlags", href: "/admin/feature-flags", icon: "🚩", section: "billing", roles: ADMIN_PLATFORM_ROLES },
  { id: "integrations", href: "/admin/integrations", icon: "🔗", section: "connectivity", roles: ADMIN_TENANT_ROLES },
  { id: "tenantIntegrations", href: "/admin/integrations/platform", icon: "✍️", section: "connectivity", roles: INTEGRATION_ADMIN_ROLES },
  { id: "platformIntegrations", href: "/admin/platform/integrations", icon: "🧩", section: "connectivity", roles: ADMIN_PLATFORM_ROLES },
  { id: "gateways", href: "/admin/gateways", icon: "📡", section: "connectivity", roles: ADMIN_PLATFORM_ROLES },
  { id: "gatewayConfig", href: "/admin/gateway-config", icon: "🧩", section: "connectivity", roles: ADMIN_PLATFORM_ROLES },
  // api_admin matches the page gate but cannot reach the hub (it admits tenant roles only); kept so the
  // tile always mirrors its destination gate (pinned by adminTiles.test.ts).
  { id: "gatewayRoutes", href: "/admin/gateway-routes", icon: "🔁", section: "connectivity", roles: API_CATALOGUE_ROLES },
  { id: "apiMonitoring", href: "/admin/api-monitoring", icon: "💚", section: "operations", roles: ADMIN_PLATFORM_ROLES },
  { id: "techAdmin", href: "/admin/tech-admin", icon: "🧰", section: "operations", roles: ADMIN_PLATFORM_ROLES },
  { id: "scheduledJobs", href: "/admin/scheduled-jobs", icon: "⏱", section: "operations", roles: ADMIN_PLATFORM_ROLES },
  { id: "discovery", href: "/admin/discovery", icon: "🔍", section: "operations", roles: ADMIN_PLATFORM_ROLES },
  { id: "bulkScan", href: "/admin/bulk-scan", icon: "📄", section: "operations", roles: BULK_SCAN_ADMIN_ROLES },
  { id: "config", href: "/admin/config", icon: "🗂", section: "operations", roles: ADMIN_PLATFORM_ROLES },
  { id: "operators", href: "/admin/operators", icon: "🪪", section: "access", roles: ADMIN_PLATFORM_ROLES },
  { id: "users", href: "/admin/users", icon: "👥", section: "access", roles: ADMIN_TENANT_ROLES },
  { id: "roles", href: "/admin/roles", icon: "🛡", section: "access", roles: ADMIN_TENANT_ROLES },
  { id: "roleFeatures", href: "/admin/role-features", icon: "🎯", section: "access", roles: ADMIN_TENANT_ROLES },
  { id: "auditLog", href: "/admin/audit-log", icon: "📒", section: "access", roles: AUDIT_LOG_VIEW_ROLES },
  { id: "devices", href: "/admin/devices", icon: "🔔", section: "access", roles: DEVICE_ADMIN_ROLES },
  { id: "settings", href: "/admin/settings", icon: "⚙", section: "tenant", roles: ADMIN_TENANT_ROLES },
  { id: "org", href: "/admin/org", icon: "🌳", section: "tenant", roles: ADMIN_TENANT_ROLES },
  { id: "tenantAdmin", href: "/tenant-admin", icon: "🏛", section: "tenant", roles: ADMIN_TENANT_ROLES },
];

type Translate = (key: string) => string;

/** Tiles visible to `sessionRoles`, with copy resolved through `t` (the `admin` namespace). */
export function visibleAdminTiles(sessionRoles: readonly string[], t: Translate): NavTile[] {
  return ADMIN_TILES.filter((d) => d.roles.some((r) => sessionRoles.includes(r))).map((d) => ({
    title: t(`tiles.${d.id}.title`),
    href: d.href,
    description: t(`tiles.${d.id}.description`),
    section: t(`sections.${d.section}`),
    icon: d.icon,
  }));
}
