import { PageHeader, StatCard } from "@/app/_components/ds";
import { Breadcrumb } from "./Breadcrumb";
import { getSessionRoles } from "@/lib/auth/roleGuard";

const NAV_ITEMS = [
  { href: "/platform-admin/system-settings", label: "⚙️ System Settings", desc: "General, Email, Security, Integrations" },
  { href: "/platform-admin/org-config", label: "🏛️ Org Configuration", desc: "Ministry → Department hierarchy" },
  { href: "/platform-admin/audit-log", label: "📋 Audit Log", desc: "All admin actions, before/after diffs" },
  { href: "/platform-admin/roles", label: "🔑 Roles & Permissions", desc: "Matrix with SoD enforcement" },
  { href: "/platform-admin/users", label: "👥 User Management", desc: "All users, role badges, bulk export" },
  { href: "/platform-admin/tenant-config", label: "🏢 Tenant Config", desc: "Tenant, Keycloak, storage, license" },
];

export default function PlatformAdminPage() {
  const roles = getSessionRoles();
  const isPlatformAdmin = roles.includes("platform_admin") || roles.includes("super_admin");

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <Breadcrumb items={[{ label: "Platform Admin" }]} />
      <PageHeader
        title="Platform Administration"
        subtitle="System-wide configuration, audit logging, roles & permissions, and tenant management."
        actions={
          isPlatformAdmin ? (
            <a href="/platform-admin/audit-log" className="btn ghost" style={{ minHeight: 44 }}>View audit log</a>
          ) : null
        }
      />
      <div className="grid g-4" style={{ marginBottom: 18 }}>
        <StatCard icon="⚙️" iconBg="#eff6ff" label="System Settings" value="4 sections" />
        <StatCard icon="🏛️" iconBg="#ecfdf3" label="Org Levels" value={5} />
        <StatCard icon="🔑" iconBg="#f1f5f9" label="Platform Roles" value={9} />
        <StatCard icon="📋" iconBg="#fffaeb" label="Audit Stream" value="Live" />
      </div>
      <div className="sec-h" style={{ marginTop: 8, marginBottom: 12 }}>Admin Sections</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 12 }}>
        {NAV_ITEMS.map((item) => (
          <a
            key={item.href}
            href={item.href}
            className="card"
            style={{ padding: "16px", textDecoration: "none", display: "flex", flexDirection: "column", gap: 4, minHeight: 44 }}
          >
            <span style={{ fontSize: 14, fontWeight: 600 }}>{item.label}</span>
            <span style={{ fontSize: 12, color: "var(--ink2)" }}>{item.desc}</span>
          </a>
        ))}
      </div>
    </main>
  );
}
