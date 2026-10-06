import { PageHeader, StatCard, StatGrid, Card, EmptyState, RefreshErrorState } from "@/app/_components/ds";
import { Breadcrumb } from "../Breadcrumb";
import { getIdpProviders } from "@/app/_data/loaders";
import { toResourceState } from "@/app/_data/useResource";
import { toHumanError } from "@/lib/messages";
import { formatDateTimeIST } from "@/lib/formatters";
import { IdpTable } from "./IdpTable";

const STALE_SYNC_MS = 24 * 60 * 60 * 1000; // 24h — a directory sync older than this is flagged.

export default async function IdpListPage() {
  const result = await getIdpProviders();
  const { data: providers, source } = result;
  const errored = toResourceState(result).status === "error";
  const activeProviders = errored ? 0 : providers.filter((p) => p.status === "active").length;
  const totalSynced = errored ? 0 : providers.reduce((sum, p) => sum + p.usersSynced, 0);

  // GAP-TENANT-ADMIN-IDP-01: the Last Sync KPI must reflect the OLDEST active
  // provider's real lastSync (a stale directory), not a hard-coded "Recent".
  const activeSyncTimes = errored
    ? []
    : providers
        .filter((p) => p.status === "active")
        .map((p) => Date.parse(p.lastSync))
        .filter((t) => !Number.isNaN(t));
  const oldestSyncMs = activeSyncTimes.length > 0 ? Math.min(...activeSyncTimes) : null;
  const lastSyncValue = errored || oldestSyncMs === null ? "—" : formatDateTimeIST(new Date(oldestSyncMs).toISOString());
  const syncStale = oldestSyncMs !== null && Date.now() - oldestSyncMs > STALE_SYNC_MS;

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      <Breadcrumb items={[{ label: "Tenant Admin", href: "/tenant-admin" }, { label: "Identity Providers" }]} />
      <PageHeader
        back="/tenant-admin"
        title="Identity Providers"
        subtitle="Configured identity providers — Keycloak, LDAP, Azure AD, Google Workspace with sync status and user counts."
      />
      {/* GAP-TENANT-ADMIN-IDP-02 (decision): there is no provider create/edit
          form on this route or /tenant-admin/sso — the old "Add Provider" CTA
          merely linked in a circle between the two list pages. Providers are
          configured by the platform team, so the dead CTA is removed and the
          relationship is stated honestly instead of looping the user. */}

      <StatGrid>
        <StatCard icon="🔗" iconBg="#eff6ff" label="Total Providers" value={errored ? "—" : providers.length} />
        <StatCard icon="✅" iconBg="#ecfdf3" label="Active" value={errored ? "—" : activeProviders} />
        <StatCard icon="👥" iconBg="#f1f5f9" label="Users Synced" value={errored ? "—" : totalSynced} />
        <StatCard
          icon="🔄"
          iconBg="#ecfdf3"
          label={syncStale ? "Last Sync (stale)" : "Last Sync"}
          value={lastSyncValue}
        />
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
            message="Identity providers are configured by the platform team. Once added, they appear here with sync status and user counts."
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
