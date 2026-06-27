import { PageHeader, StatCard, StatGrid, Card, DataTable, StatusPill } from "@/app/_components/ds";
import { Breadcrumb } from "../Breadcrumb";

type IdentityProvider = {
  id: string;
  name: string;
  protocol: string;
  entityId: string;
  status: string;
  lastSync: string;
};

const providers: IdentityProvider[] = [
  { id: "idp-001", name: "Azure AD (Production)", protocol: "OIDC", entityId: "https://login.microsoftonline.com/tenant-abc", status: "active", lastSync: "2025-01-15T14:00:00Z" },
  { id: "idp-002", name: "Keycloak (Internal)", protocol: "SAML 2.0", entityId: "https://sso.internal.gov.in/realms/civitas", status: "active", lastSync: "2025-01-15T13:45:00Z" },
  { id: "idp-003", name: "Google Workspace", protocol: "OIDC", entityId: "https://accounts.google.com", status: "inactive", lastSync: "2025-01-10T08:30:00Z" },
];

export default function SSOPage() {
  const activeProviders = providers.filter((p) => p.status === "active").length;
  const totalUsers = 342;

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

      <StatGrid>
        <StatCard icon="🔗" iconBg="#eff6ff" label="Active Providers" value={activeProviders} />
        <StatCard icon="👥" iconBg="#ecfdf3" label="SSO Users" value={totalUsers} />
        <StatCard icon="🛡️" iconBg="#f1f5f9" label="Protocols" value="SAML / OIDC" />
        <StatCard icon="✅" iconBg="#ecfdf3" label="Last Sync" value="2 min ago" />
      </StatGrid>
      <Card title="Configured Identity Providers">
        <DataTable<IdentityProvider & Record<string, unknown>>
          columns={[
            { key: "name", label: "Provider Name" },
            { key: "protocol", label: "Protocol" },
            { key: "entityId", label: "Entity ID", render: (row) => <span className="mono" style={{ fontSize: 12 }}>{row.entityId as string}</span> },
            { key: "status", label: "Status", render: (row) => <StatusPill status={row.status as string} /> },
            { key: "lastSync", label: "Last Sync", render: (row) => new Date(row.lastSync as string).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) },
          ]}
          rows={providers as (IdentityProvider & Record<string, unknown>)[]}
        />
      </Card>
    </main>
  );
}
