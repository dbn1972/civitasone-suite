import { PageHeader, StatCard, StatGrid, Card, EmptyState, RefreshErrorState } from "@/app/_components/ds";
import { Breadcrumb } from "../Breadcrumb";
import { getIdpProviders } from "@/app/_data/loaders";
import { toResourceState } from "@/app/_data/useResource";
import { toHumanError } from "@/lib/messages";
import { IdpTable } from "./IdpTable";

export default async function IdpListPage() {
  const result = await getIdpProviders();
  const { data: providers, source } = result;
  const errored = toResourceState(result).status === "error";
  const activeProviders = errored ? 0 : providers.filter((p) => p.status === "active").length;
  const totalSynced = errored ? 0 : providers.reduce((sum, p) => sum + p.usersSynced, 0);

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      <Breadcrumb items={[{ label: "Tenant Admin", href: "/tenant-admin" }, { label: "Identity Providers" }]} />
      <PageHeader
        back="/tenant-admin"
        title="Identity Providers"
        subtitle="Configured identity providers — Keycloak, LDAP, Azure AD, Google Workspace with sync status and user counts."
        actions={
          <a href="/tenant-admin/sso" className="btn primary" aria-label="Add new identity provider" style={{ minHeight: 44 }}>
            Add Provider
          </a>
        }
      />
      {/* UX-012: the data-source badge now lives inside IdpTable, driven by
          the same useSeededResource call that produces its rows — not a
          second, independent read of `source` here that could disagree
          with the table's own cache state (UX-002's pattern). */}

      <StatGrid>
        <StatCard icon="🔗" iconBg="#eff6ff" label="Total Providers" value={errored ? "—" : providers.length} />
        <StatCard icon="✅" iconBg="#ecfdf3" label="Active" value={errored ? "—" : activeProviders} />
        <StatCard icon="👥" iconBg="#f1f5f9" label="Users Synced" value={errored ? "—" : totalSynced} />
        <StatCard icon="🔄" iconBg="#ecfdf3" label="Last Sync" value={errored ? "—" : providers.length > 0 ? "Recent" : "—"} />
      </StatGrid>

      {errored ? (
        <Card title="Configured Providers">
          <RefreshErrorState error={toHumanError("load", { area: "identity providers" })} backHref="/tenant-admin" />
        </Card>
      ) : providers.length === 0 ? (
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
    </div>
  );
}
