import { PageHeader, StatCard, StatGrid, Card, DataTable, StatusPill } from "@/app/_components/ds";
import { Breadcrumb } from "../Breadcrumb";

type IdpProvider = {
  id: string;
  name: string;
  protocol: string;
  status: string;
  usersSynced: number;
  lastSync: string;
  endpoint: string;
};

const providers: IdpProvider[] = [
  { id: "idp-001", name: "Keycloak", protocol: "OIDC / SAML 2.0", status: "active", usersSynced: 245, lastSync: "2025-01-15T14:30:00Z", endpoint: "https://sso.internal.gov.in/realms/civitas" },
  { id: "idp-002", name: "LDAP (Active Directory)", protocol: "LDAP v3", status: "active", usersSynced: 189, lastSync: "2025-01-15T14:00:00Z", endpoint: "ldaps://ad.internal.gov.in:636" },
  { id: "idp-003", name: "Azure AD", protocol: "OIDC", status: "active", usersSynced: 312, lastSync: "2025-01-15T13:45:00Z", endpoint: "https://login.microsoftonline.com/tenant-xyz" },
  { id: "idp-004", name: "Google Workspace", protocol: "OIDC", status: "inactive", usersSynced: 0, lastSync: "2025-01-10T08:00:00Z", endpoint: "https://accounts.google.com" },
];

export default function IdpListPage() {
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

      <StatGrid>
        <StatCard icon="🔗" iconBg="#eff6ff" label="Total Providers" value={providers.length} />
        <StatCard icon="✅" iconBg="#ecfdf3" label="Active" value={activeProviders} />
        <StatCard icon="👥" iconBg="#f1f5f9" label="Users Synced" value={totalSynced} />
        <StatCard icon="🔄" iconBg="#ecfdf3" label="Last Sync" value="30 min ago" />
      </StatGrid>
      <Card title="Configured Providers">
        <DataTable<IdpProvider & Record<string, unknown>>
          columns={[
            { key: "name", label: "Provider" },
            { key: "protocol", label: "Protocol" },
            { key: "status", label: "Status", render: (row) => <StatusPill status={row.status as string} /> },
            { key: "usersSynced", label: "Users Synced" },
            { key: "endpoint", label: "Endpoint", render: (row) => <span className="mono" style={{ fontSize: 11 }}>{row.endpoint as string}</span> },
            { key: "lastSync", label: "Last Sync", render: (row) => new Date(row.lastSync as string).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) },
          ]}
          rows={providers as (IdpProvider & Record<string, unknown>)[]}
        />
      </Card>
    </main>
  );
}
