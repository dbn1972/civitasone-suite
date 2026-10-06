import { PageHeader, StatCard, StatGrid, Card, EmptyState, RefreshErrorState } from "@/app/_components/ds";
import { Breadcrumb } from "../Breadcrumb";
import { getSsoProviders } from "@/app/_data/loaders";
import { SsoTable } from "./SsoTable";
import { toResourceState } from "@/app/_data/useResource";
import { toHumanError } from "@/lib/messages";
import { formatIndianDateTime } from "@/lib/formatters";

/** Latest valid lastSync across providers as an ISO string, or null. */
function latestSyncIso(providers: { lastSync?: string }[]): string | null {
  let best: number | null = null;
  for (const p of providers) {
    if (!p.lastSync) continue;
    const t = new Date(p.lastSync).getTime();
    if (!Number.isNaN(t) && (best === null || t > best)) best = t;
  }
  return best === null ? null : new Date(best).toISOString();
}

/** Distinct protocols actually configured, e.g. "OIDC" or "SAML / OIDC". */
function configuredProtocols(providers: { protocol?: string }[]): string {
  const set = new Set<string>();
  for (const p of providers) if (p.protocol) set.add(p.protocol.toUpperCase());
  return set.size === 0 ? "—" : [...set].sort().join(" / ");
}

export default async function SSOPage() {
  const result = await getSsoProviders();
  const { data: providers, source } = result;
  const resource = toResourceState(result);
  const errored = resource.status === "error";
  const activeProviders = errored ? null : providers.filter((p) => p.status === "active").length;
  const latest = errored ? null : latestSyncIso(providers);

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      <Breadcrumb items={[{ label: "Tenant Admin", href: "/tenant-admin" }, { label: "SSO & Identity Providers" }]} />
      {/* GAP-TENANT-ADMIN-SSO-01 (DECISION, recorded): there is no SSO/IdP
          provider store yet — admin-service GET /v1/admin/sso/providers returns
          501 and identity-service's SAML config route is an unfinished stub
          that persists nothing. The old "Configure IDP" button bounced to
          /tenant-admin/idp whose own "Add Provider" bounced back here, so no
          screen ever added a provider. Rather than ship a form that POSTs to a
          501, this page is honestly read-only until the backend provider store
          + test-connection flow exists (HUMAN REVIEW). No circular link. */}
      <PageHeader
        back="/tenant-admin"
        title="SSO & Identity Providers"
        subtitle="SAML/OIDC identity providers configured for single sign-on. Read-only — providers are provisioned by platform operations."
      />
      <StatGrid>
        <StatCard icon="🔗" iconBg="#eff6ff" label="Active Providers" value={activeProviders ?? "—"} />
        <StatCard icon="🔗" iconBg="#ecfdf3" label="Total Providers" value={errored ? "—" : providers.length} />
        <StatCard icon="🛡️" iconBg="#f1f5f9" label="Protocols" value={errored ? "—" : configuredProtocols(providers)} />
        <StatCard icon="✅" iconBg="#ecfdf3" label="Last Sync" value={errored ? "—" : formatIndianDateTime(latest)} />
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
            message="Single sign-on providers are provisioned by platform operations. Contact your platform administrator to add one."
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
