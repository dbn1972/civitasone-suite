import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { PageHeader, StatCard } from "../../../_components/ds";
import { getAPIKeys } from "../../../_data/loaders";
import { APIKeysTable } from "./APIKeysTable";
import { APIKeyActions } from "./APIKeyActions";
import { Breadcrumb } from "../Breadcrumb";

export default async function APIKeysPage() {
  const { data: keys, source } = await getAPIKeys();

  const total = keys.length;
  const active = keys.filter((k) => k.status === "active").length;
  const expired = keys.filter((k) => k.status === "expired").length;
  const neverUsed = keys.filter((k) => !k.lastUsedAt).length;

  return (
    <div className="wrap">
      <Breadcrumb items={[{ label: "Tenant Admin", href: "/tenant-admin" }, { label: "API Keys" }]} />
      <PageHeader
        back="/tenant-admin"
        title="API Keys"
        subtitle="Service-to-service and external API access keys."
      />
      <div className="grid g-4" style={{ marginBottom: 18 }}>
        <StatCard icon="🔑" iconBg="#f1f5f9" label="Total Keys" value={total} />
        <StatCard icon="✅" iconBg="#ecfdf3" label="Active" value={active} />
        <StatCard icon="⏰" iconBg="#fffaeb" label="Expired" value={expired} />
        <StatCard icon="🚫" iconBg="#fef3f2" label="Never Used" value={neverUsed} />
      </div>
      {source === "error" && <DataSourceBadge source={source} />}
      <div className="grid g-2" style={{ marginTop: 18, alignItems: "start" }}>
        <APIKeysTable keys={keys} />
        <APIKeyActions keys={keys.map((k) => ({ id: k.id, keyName: k.keyName, status: k.status }))} />
      </div>
    </div>
  );
}
