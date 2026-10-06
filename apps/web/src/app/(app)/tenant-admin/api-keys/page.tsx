import { PageHeader, StatCard, RefreshErrorState } from "../../../_components/ds";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { getAPIKeys } from "../../../_data/loaders";
import { toResourceState } from "../../../_data/useResource";
import { toHumanError } from "@/lib/messages";
import { APIKeysTable } from "./APIKeysTable";
import { APIKeyActions } from "./APIKeyActions";
import { Breadcrumb } from "../Breadcrumb";

export default async function APIKeysPage() {
  const result = await getAPIKeys();
  const { data: keys, source } = result;
  // GAP-TENANT-ADMIN-API-KEYS-02 (FAILMASK): KPI cards were not gated on
  // source==='error', so a failed load printed 0/0/0/0 with only a small
  // badge — indistinguishable from a tenant with no keys. Gate on it, same
  // pattern as compliance/page.tsx.
  const state = toResourceState(result, (d) => d.length === 0);
  const errored = state.status === "error";

  const total = keys.length;
  const active = keys.filter((k) => k.status === "active").length;
  const expired = keys.filter((k) => k.status === "expired").length;
  const neverUsed = keys.filter((k) => !k.lastUsedAt).length;

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      <Breadcrumb items={[{ label: "Tenant Admin", href: "/tenant-admin" }, { label: "API Keys" }]} />
      <PageHeader
        back="/tenant-admin"
        title="API Keys"
        subtitle="Service-to-service and external API access keys."
      />
      <div className="grid g-4" style={{ marginBottom: 18 }}>
        <StatCard icon="🔑" iconBg="#f1f5f9" label="Total Keys" value={errored ? "—" : total} />
        <StatCard icon="✅" iconBg="#ecfdf3" label="Active" value={errored ? "—" : active} />
        <StatCard icon="⏰" iconBg="#fffaeb" label="Expired" value={errored ? "—" : expired} />
        <StatCard icon="🚫" iconBg="#fef3f2" label="Never Used" value={errored ? "—" : neverUsed} />
      </div>
      {source === "error" && <DataSourceBadge source={source} />}
      {errored ? (
        <RefreshErrorState error={toHumanError("load", { area: "API keys" })} backHref="/tenant-admin" />
      ) : (
        <div className="grid g-2" style={{ marginTop: 18, alignItems: "start" }}>
          <APIKeysTable keys={keys} />
          <APIKeyActions keys={keys.map((k) => ({ id: k.id, keyName: k.keyName, status: k.status }))} />
        </div>
      )}
    </div>
  );
}
