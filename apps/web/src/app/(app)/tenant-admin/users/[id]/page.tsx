import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { PageHeader, StatusPill } from "../../../../_components/ds";
import { getAdminUserById } from "../../../../_data/loaders";
import { UserSecurityActions } from "./UserSecurityActions";
import { SessionRevokeCell } from "./SessionRevokeCell";

export default async function AdminUserDetailPage({ params }: { params: { id: string } }) {
  const { data: user, source } = await getAdminUserById(params.id);

  if (!user) {
    return (
      <div className="wrap">
        <a href="/tenant-admin/users" className="back">← Back</a>
        <p style={{ color: "#667085", marginTop: 16 }}>User not found.</p>
      </div>
    );
  }

  return (
    <div className="wrap">
      <PageHeader
        back="/tenant-admin/users"
        title={user.name ?? user.email}
        subtitle={user.email}
        actions={
          <>
            <UserSecurityActions userId={user.id} />
            {source === "error" && <DataSourceBadge source={source} />}
          </>
        }
      />
      <div className="grid g-main" style={{ alignItems: "start" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div className="card">
            <div className="card-h"><h3>Profile</h3></div>
            <div className="fields">
              <div className="fld"><div className="l">Email</div><div className="v">{user.email}</div></div>
              <div className="fld"><div className="l">Name</div><div className="v">{user.name ?? "—"}</div></div>
              <div className="fld"><div className="l">Roles</div><div className="v">{user.roles.length > 0 ? user.roles.join(", ") : "—"}</div></div>
              <div className="fld"><div className="l">MFA</div><div className="v">{user.mfaEnabled ? <span className="pill good">Enabled</span> : <span className="pill mut">Disabled</span>}</div></div>
              <div className="fld"><div className="l">Status</div><div className="v"><StatusPill status={user.status} label={user.status.replace(/_/g, " ")} /></div></div>
              <div className="fld"><div className="l">Last login</div><div className="v">{user.lastLoginAt ? user.lastLoginAt.slice(0, 10) : "—"}</div></div>
              <div className="fld"><div className="l">Created</div><div className="v">{user.createdAt.slice(0, 10)}</div></div>
            </div>
          </div>
        </div>
        <div className="card">
          <div className="card-h"><h3>Active sessions</h3></div>
          <table className="tbl">
            <thead>
              <tr>
                <th>IP address</th>
                <th>Created</th>
                <th>Last active</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {user.sessions.map((s: { id: string; ipAddress?: string; createdAt: string; lastActiveAt: string; status: string }) => (
                <tr key={s.id}>
                  <td><span className="mono">{s.ipAddress ?? "—"}</span></td>
                  <td>{s.createdAt.slice(0, 16).replace("T", " ")}</td>
                  <td>{s.lastActiveAt.slice(0, 16).replace("T", " ")}</td>
                  <td>
                    {s.status === "active" ? <span className="pill good">Active</span>
                      : s.status === "revoked" ? <span className="pill bad">Revoked</span>
                      : <span className="pill mut">Expired</span>}
                  </td>
                  <td><SessionRevokeCell sessionId={s.id} active={s.status === "active"} /></td>
                </tr>
              ))}
              {user.sessions.length === 0 && (
                <tr><td colSpan={5}><div className="empty-state"><div>🖥️</div><h4>No sessions</h4><p>No active sessions for this user.</p></div></td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
