import { PageHeader, StatCard, StatGrid, Card, DataTable, StatusPill, EmptyState, RefreshErrorState } from "@/app/_components/ds";
import { Breadcrumb } from "../Breadcrumb";
import { getSsoProviders, type SsoProvider } from "@/app/_data/loaders";
import { SsoTable } from "./SsoTable";
import { toResourceState } from "@/app/_data/useResource";
import { toHumanError } from "@/lib/messages";

export default async function SSOPage() {
  const result = await getSsoProviders();
  const { data: providers, source } = result;
  const resource = toResourceState(result);
  const errored = resource.status === "error";
  const activeProviders = errored ? null : providers.filter((p) => p.status === "active").length;
  const totalUsers = providers.reduce((sum, p) => sum + (p.status === "active" ? 1 : 0), 0);

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      <Breadcrumb items={[{ label: "Tenant Admin", href: "/tenant-admin" }, { label: "SSO & Identity Providers" }]} />
      <PageHeader
        back="/tenant-admin"
        title="SSO & Identity Providers"
        subtitle="Configure SAML/OIDC identity providers for single sign-on authentication."
        actions={
          <a href="/tenant-admin/idp" className="btn primary" aria-label="Configure Identity Provider" style={{ minHeight: 44 }}>
            Configure IDP
          </a>
        }
      />
      <StatGrid>
        <StatCard icon="🔗" iconBg="#eff6ff" label="Active Providers" value={activeProviders ?? "—"} />
        <StatCard icon="👥" iconBg="#ecfdf3" label="Total Providers" value={errored ? "—" : providers.length} />
        <StatCard icon="🛡️" iconBg="#f1f5f9" label="Protocols" value="SAML / OIDC" />
        <StatCard icon="✅" iconBg="#ecfdf3" label="Last Sync" value={!errored && providers.length > 0 ? "Recent" : "—"} />
      </StatGrid>

      {errored ? (
        <Card title="Configured Identity Providers">
          <RefreshErrorState error={toHumanError("load", { area: "identity providers" })} backHref="/tenant-admin" />
        </Card>
      ) : providers.length === 0 ? (
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
    </div>
  );
}
