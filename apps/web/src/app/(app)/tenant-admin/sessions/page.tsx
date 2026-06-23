import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { PageHeader, StatCard } from "../../../_components/ds";
import { getActiveSessions } from "../../../_data/loaders";

export default async function AdminSessionsPage() {
  const { data: sessions, source } = await getActiveSessions();

  const total = sessions.length;
  const active = sessions.filter((s) => s.status === "active").length;
  const locations = new Set(sessions.map((s) => s.ipAddress?.split(".").slice(0, 2).join(".") ?? "unknown")).size;
  const mfaVerified = sessions.filter((s) => s.mfaVerified).length;
  const suspicious = sessions.filter((s) => !s.mfaVerified && s.status === "active").length;

  return (
    <div className="wrap">
      <PageHeader
        back="/tenant-admin"
        title="Active Sessions"
        subtitle="All active and recent user sessions for this tenant."
        actions={
          <>
            <button className="btn ghost">Export</button>
            <button className="btn primary">Revoke all</button>
          </>
        }
      />
      <div className="grid g-4" style={{ marginBottom: 18 }}>
        <StatCard icon="🖥️" iconBg="#f1f5f9" label="Active Sessions" value={active} />
        <StatCard icon="📍" iconBg="#eff6ff" label="Locations" value={locations} />
        <StatCard icon="🔐" iconBg="#ecfdf3" label="MFA Verified" value={mfaVerified} />
        <StatCard icon="⚠️" iconBg="#fef3f2" label="Suspicious" value={suspicious} />
      </div>
      {source === "error" && <DataSourceBadge source={source} />}
      <div className="card">
        <div className="card-h">
          <h3>Session log</h3>
          <div className="seg"><span className="on">All</span><span>Active</span></div>
        </div>
        <table className="tbl">
          <thead>
            <tr>
              <th>User</th>
              <th>IP address</th>
              <th>Last active</th>
              <th>MFA</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {sessions.map((s) => (
              <tr key={s.id}>
                <td>
                  <div className="who">
                    <div className="av">{(s.userName ?? s.userEmail).slice(0, 2).toUpperCase()}</div>
                    <div>
                      <div className="nm">{s.userName ?? "—"}</div>
                      <div className="ml">{s.userEmail}</div>
                    </div>
                  </div>
                </td>
                <td><span className="mono">{s.ipAddress ?? "—"}</span></td>
                <td>{s.lastActiveAt.slice(0, 16).replace("T", " ")}</td>
                <td>{s.mfaVerified ? <span className="pill good">Yes</span> : <span className="pill mut">No</span>}</td>
                <td>
                  {s.status === "active" ? <span className="pill good">Active</span>
                    : s.status === "revoked" ? <span className="pill bad">Revoked</span>
                    : <span className="pill mut">Expired</span>}
                </td>
                <td><span style={{ fontSize: 12, color: "#667085", cursor: "not-allowed" }}>Revoke</span></td>
              </tr>
            ))}
            {sessions.length === 0 && (
              <tr><td colSpan={6}><div className="empty-state"><div>🖥️</div><h4>No sessions</h4><p>Active user sessions will appear here.</p></div></td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
