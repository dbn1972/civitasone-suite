import Link from "next/link";
import { PageHeader, StatCard } from "@/app/_components/ds";
import { Breadcrumb } from "./Breadcrumb";
import { getSessionRoles, requireAnyRole, PLATFORM_ADMIN_ROLES } from "@/lib/auth/roleGuard";
import { getAdminRolesList, getOrgHierarchyLevels, getTenantAuditLog } from "@/app/_data/loaders";
import { formatIndianDateTime } from "@/lib/formatters";

// GAP-PLATFORM-ADMIN-HOME-03: icon and label are separate fields; the emoji
// is rendered in an aria-hidden span so a screen reader announces the link as
// e.g. "System Settings", not "gear System Settings". Labels are plain
// English constants, consistent with the rest of the (hard-coded-English)
// platform-admin segment — a next-intl migration for this one nav list alone
// would be inconsistent with every sibling page and is deferred as a
// segment-wide effort (DECISION, recorded in the gap report).
const NAV_ITEMS = [
  { href: "/platform-admin/system-settings", icon: "⚙️", label: "System Settings", desc: "General, Email, Security, Integrations" },
  { href: "/platform-admin/org-config", icon: "🏛️", label: "Org Configuration", desc: "Ministry → Department hierarchy" },
  { href: "/platform-admin/audit-log", icon: "📋", label: "Audit Log", desc: "All admin actions, before/after diffs" },
  { href: "/platform-admin/roles", icon: "🔑", label: "Roles & Permissions", desc: "Matrix with SoD enforcement" },
  { href: "/platform-admin/users", icon: "👥", label: "User Management", desc: "All users, role badges, bulk export" },
  { href: "/platform-admin/tenant-config", icon: "🏢", label: "Tenant Config", desc: "Tenant, Keycloak, storage, license" },
];

export default async function PlatformAdminPage() {
  requireAnyRole(PLATFORM_ADMIN_ROLES, "/dashboard");
  const roles = getSessionRoles();
  const isPlatformAdmin = roles.includes("platform_admin") || roles.includes("super_admin");

  // GAP-PLATFORM-ADMIN-HOME-02: stat tiles are driven by real data, not
  // literals ("4 sections", 5, 9, "Live"). A source in error renders "—"
  // (StatCard's null convention) rather than a fabricated figure.
  const [rolesResult, levelsResult, auditResult] = await Promise.all([
    getAdminRolesList(),
    getOrgHierarchyLevels(),
    getTenantAuditLog(),
  ]);

  const roleCount = rolesResult.source === "error" ? null : rolesResult.data.length;
  const levelCount = levelsResult.source === "error" ? null : levelsResult.data.length;
  // "Audit Stream" tile: honest latest-event time (or "No events"), never a
  // bare "Live" shown regardless of the audit API's health.
  const latestEvent = auditResult.source === "error"
    ? null
    : auditResult.data
        .map((e) => e.timestamp)
        .filter(Boolean)
        .sort()
        .at(-1);
  const auditValue = auditResult.source === "error"
    ? null
    : latestEvent
      ? formatIndianDateTime(latestEvent)
      : "No events";

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      <Breadcrumb items={[{ label: "Platform Admin" }]} />
      <PageHeader
        title="Platform Administration"
        subtitle="System-wide configuration, audit logging, roles & permissions, and tenant management."
        actions={
          isPlatformAdmin ? (
            <Link href="/platform-admin/audit-log" className="btn ghost" style={{ minHeight: 44 }}>View audit log</Link>
          ) : null
        }
      />
      <div className="grid g-4" style={{ marginBottom: 18 }}>
        <StatCard icon="🏛️" iconBg="#ecfdf3" label="Org Levels" value={levelCount} />
        <StatCard icon="🔑" iconBg="#f1f5f9" label="Platform Roles" value={roleCount} />
        <StatCard icon="📋" iconBg="#fffaeb" label="Latest audit event" value={auditValue} />
      </div>
      <div className="sec-h" style={{ marginTop: 8, marginBottom: 12 }}>Admin Sections</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 12 }}>
        {NAV_ITEMS.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="card"
            style={{ padding: "16px", textDecoration: "none", display: "flex", flexDirection: "column", gap: 4, minHeight: 44 }}
          >
            <span style={{ fontSize: 14, fontWeight: 600 }}>
              <span aria-hidden="true" style={{ marginInlineEnd: 6 }}>{item.icon}</span>
              {item.label}
            </span>
            <span style={{ fontSize: 12, color: "var(--ink2)" }}>{item.desc}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
