import { PageHeader, StatCard, StatGrid, Card, EmptyState } from "@/app/_components/ds";
import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { Breadcrumb } from "../Breadcrumb";
import { getIdpProviders } from "@/app/_data/loaders";
import { IdpTable } from "./IdpTable";

export default async function IdpListPage() {
  const { data: providers, source } = await getIdpProviders();
  const activeProviders = providers.filter((p) => p.status === "active").length;
  const totalSynced = providers.reduce((sum, p) => sum + p.usersSynced, 0);

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <Breadcrumb items={[{ label: "Tenant Admin", href: "/tenant-admin" }, { label: "Identity Providers" }]} />
      <PageHeader
        back="/tenant-admin"
        title="Identity Providers"
        subtitle="Configured identity providers — Keycloak, LDAP, Azure AD, Google Workspace with sync status and user counts."
        actions={
          <a href="/tenant-admin/sso" className="btn primary" role="link" aria-label="Add new identity provider" style={{ minHeight: 44 }}>
            Add Provider
          </a>
        }
      />
      <DataSourceBadge source={source} />

      <StatGrid>
        <StatCard icon="🔗" iconBg="#eff6ff" label="Total Providers" value={providers.length} />
        <StatCard icon="✅" iconBg="#ecfdf3" label="Active" value={activeProviders} />
        <StatCard icon="👥" iconBg="#f1f5f9" label="Users Synced" value={totalSynced} />
        <StatCard icon="🔄" iconBg="#ecfdf3" label="Last Sync" value={providers.length > 0 ? "Recent" : "—"} />
      </StatGrid>

      {providers.length === 0 ? (
        <Card title="Configured Providers">
          <EmptyState
            icon="🔗"
            title="No identity providers configured"
            message="Add a provider to enable SSO and directory sync."
            action={<a href="/tenant-admin/sso" className="btn primary">Add Provider</a>}
          />
        </Card>
      ) : (
        <Card title="Configured Providers">
          <IdpTable providers={providers} source={source} />
        </Card>
      )}
    </main>
  );
}
