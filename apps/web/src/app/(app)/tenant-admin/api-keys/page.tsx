import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { PageHeader, StatCard } from "../../../_components/ds";
import { getAPIKeys } from "../../../_data/loaders";

export default async function APIKeysPage() {
  const { data: keys, source } = await getAPIKeys();

  const total = keys.length;
  const active = keys.filter((k) => k.status === "active").length;
  const expired = keys.filter((k) => k.status === "expired").length;
  const neverUsed = keys.filter((k) => !k.lastUsedAt).length;

  return (
    <div className="wrap">
      <PageHeader
        back="/tenant-admin"
        title="API Keys"
        subtitle="Service-to-service and external API access keys."
        actions={
          <>
            <button className="btn ghost">Audit log</button>
            <button className="btn primary">+ New API Key</button>
          </>
        }
      />
      <div className="grid g-4" style={{ marginBottom: 18 }}>
        <StatCard icon="🔑" iconBg="#f1f5f9" label="Total Keys" value={total} />
        <StatCard icon="✅" iconBg="#ecfdf3" label="Active" value={active} />
        <StatCard icon="⏰" iconBg="#fffaeb" label="Expired" value={expired} />
        <StatCard icon="🚫" iconBg="#fef3f2" label="Never Used" value={neverUsed} />
      </div>
      {source === "error" && <DataSourceBadge source={source} />}
      <div className="grid g-2" style={{ marginTop: 18 }}>
        <div className="card">
          <div className="card-h">
            <h3>API keys</h3>
            <div className="seg"><span className="on">All</span><span>Active</span></div>
          </div>
          <table className="tbl">
            <thead>
              <tr>
                <th>Name</th>
                <th>Scope</th>
                <th>Last used</th>
                <th>Expires</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {keys.map((key) => (
                <tr key={key.id}>
                  <td>
                    <div style={{ fontWeight: 500 }}>{key.keyName}</div>
                    <div style={{ fontSize: 11, color: "#98a2b3" }}><span className="mono">{key.keyPrefix}****</span></div>
                  </td>
                  <td>{key.scopes.length > 0 ? key.scopes.join(", ") : "—"}</td>
                  <td>{key.lastUsedAt ? key.lastUsedAt.slice(0, 10) : "Never"}</td>
                  <td>{key.expiresAt ? key.expiresAt.slice(0, 10) : "—"}</td>
                  <td>
                    {key.status === "active" ? <span className="pill good">Active</span>
                      : key.status === "revoked" ? <span className="pill bad">Revoked</span>
                      : <span className="pill mut">Expired</span>}
                  </td>
                </tr>
              ))}
              {keys.length === 0 && (
                <tr><td colSpan={5}><div className="empty-state"><div>🔑</div><h4>No API keys yet</h4><p>API keys will appear here once created.</p></div></td></tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="card">
          <div className="card-h"><h3>Webhooks</h3><button className="btn ghost" style={{ fontSize: 12, padding: "4px 10px" }}>+ Add endpoint</button></div>
          <div className="empty-state" style={{ paddingTop: 40 }}>
            <div>🔗</div>
            <h4>No webhooks configured</h4>
            <p>Add webhook endpoints to receive real-time event notifications.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
