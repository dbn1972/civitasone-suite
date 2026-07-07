import { PageHeader, StatCard, StatGrid, Card, DataTable, StatusPill, EmptyState } from "@/app/_components/ds";
import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { Breadcrumb } from "../Breadcrumb";
import { getSsoProviders, type SsoProvider } from "@/app/_data/loaders";
import { SsoTable } from "./SsoTable";

export default async function SSOPage() {
  const { data: providers, source } = await getSsoProviders();
  const activeProviders = providers.filter((p) => p.status === "active").length;
  const totalUsers = providers.reduce((sum, p) => sum + (p.status === "active" ? 1 : 0), 0);

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <Breadcrumb items={[{ label: "Tenant Admin", href: "/tenant-admin" }, { label: "SSO & Identity Providers" }]} />
      <PageHeader
        back="/tenant-admin"
        title="SSO & Identity Providers"
        subtitle="Configure SAML/OIDC identity providers for single sign-on authentication."
        actions={
          <a href="/tenant-admin/idp" className="btn primary" role="link" aria-label="Configure Identity Provider" style={{ minHeight: 44 }}>
            Configure IDP
          </a>
        }
      />
      <DataSourceBadge source={source} />

      <StatGrid>
        <StatCard icon="🔗" iconBg="#eff6ff" label="Active Providers" value={activeProviders} />
        <StatCard icon="👥" iconBg="#ecfdf3" label="Total Providers" value={providers.length} />
        <StatCard icon="🛡️" iconBg="#f1f5f9" label="Protocols" value="SAML / OIDC" />
        <StatCard icon="✅" iconBg="#ecfdf3" label="Last Sync" value={providers.length > 0 ? "Recent" : "—"} />
      </StatGrid>

      {providers.length === 0 ? (
        <Card title="Configured Identity Providers">
          <EmptyState
            icon="🔗"
            title="No identity providers configured"
            message="Add an OIDC or SAML provider to enable single sign-on for your organisation."
            action={<a href="/tenant-admin/idp" className="btn primary">Configure IDP</a>}
          />
        </Card>
      ) : (
        <Card title="Configured Identity Providers">
          <SsoTable providers={providers} source={source} />
        </Card>
      )}
    </main>
  );
}
