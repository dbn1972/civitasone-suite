import { PageHeader, StatCard } from "@/app/_components/ds";
import { Breadcrumb } from "../Breadcrumb";
import { TenantConfigCard } from "./TenantConfigCard";
import { getSessionRoles } from "@/lib/auth/roleGuard";

export default function TenantConfigPage() {
  const roles = getSessionRoles();
  const isPlatformAdmin = roles.includes("platform_admin") || roles.includes("super_admin");

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <Breadcrumb items={[{ label: "Platform Admin", href: "/platform-admin" }, { label: "Tenant Config" }]} />
      <PageHeader
        back="/platform-admin"
        title="Tenant Configuration"
        subtitle="Tenant identity, infrastructure (DB schema, Keycloak realm), storage quota, and license details."
      />
      <div className="grid g-4" style={{ marginBottom: 18 }}>
        <StatCard icon="🏢" iconBg="#eff6ff" label="Tenant" value="Active" />
        <StatCard icon="🗄️" iconBg="#ecfdf3" label="DB schema" value="Isolated" />
        <StatCard icon="🔐" iconBg="#f1f5f9" label="SSO realm" value="Keycloak" />
        <StatCard icon="📄" iconBg="#fffaeb" label="License" value="Enterprise" />
      </div>
      {!isPlatformAdmin && (
        <p style={{ fontSize: 13, color: "var(--ink2)", marginBottom: 16, padding: "10px 14px", background: "var(--warnbg, #fffaeb)", borderRadius: 8, border: "1px solid var(--warnbd, #fec84b)" }}>
          You are viewing tenant config in read-only mode. Contact a platform admin to modify these settings.
        </p>
      )}
      <TenantConfigCard isPlatformAdmin={isPlatformAdmin} />
    </main>
  );
}
