import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { PageHeader } from "../../../../_components/ds";
import { getAdminRoleById } from "../../../../_data/loaders";

export default async function AdminRoleDetailPage({ params }: { params: { id: string } }) {
  const { data: role, source } = await getAdminRoleById(params.id);

  if (!role) {
    return (
      <div className="wrap">
        <a href="/tenant-admin/roles" className="back">← Back</a>
        <p style={{ color: "#667085", marginTop: 16 }}>Role not found.</p>
      </div>
    );
  }

  return (
    <div className="wrap">
      <PageHeader
        back="/tenant-admin/roles"
        title={role.name}
        subtitle={role.description ?? "Role permissions and user assignments"}
        actions={
          <>
            {role.isSystemRole
              ? <span className="pill info">System role</span>
              : <span className="pill mut">Custom role</span>}
            {!role.isSystemRole && <button className="btn primary">Edit role</button>}
            {source === "error" && <DataSourceBadge source={source} />}
          </>
        }
      />
      <div className="grid g-main" style={{ alignItems: "start" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div className="card">
            <div className="card-h"><h3>Details</h3></div>
            <div className="fields">
              <div className="fld"><div className="l">Name</div><div className="v">{role.name}</div></div>
              <div className="fld"><div className="l">Type</div><div className="v">{role.isSystemRole ? "System" : "Custom"}</div></div>
              <div className="fld"><div className="l">Users assigned</div><div className="v">{role.userCount}</div></div>
              <div className="fld"><div className="l">Created</div><div className="v">{role.createdAt.slice(0, 10)}</div></div>
              {role.description && <div className="fld"><div className="l">Description</div><div className="v">{role.description}</div></div>}
            </div>
          </div>
          <div className="card">
            <div className="card-h"><h3>Permissions</h3><span className="pill info">{role.permissions.length} rules</span></div>
            <table className="tbl">
              <thead>
                <tr>
                  <th>Module</th>
                  <th>Action</th>
                  <th>Resource</th>
                  <th>Allowed</th>
                </tr>
              </thead>
              <tbody>
                {role.permissions.map((perm: { module: string; action: string; resource?: string; allowed: boolean }, i: number) => (
                  <tr key={i}>
                    <td><span className="mono">{perm.module}</span></td>
                    <td>{perm.action}</td>
                    <td>{perm.resource ?? "—"}</td>
                    <td>{perm.allowed ? <span className="pill good">Yes</span> : <span className="pill bad">No</span>}</td>
                  </tr>
                ))}
                {role.permissions.length === 0 && (
                  <tr><td colSpan={4}><div className="empty-state"><div>🔑</div><h4>No permissions</h4><p>No permission rules defined for this role.</p></div></td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
        <div className="card">
          <div className="card-h"><h3>Permission toggles</h3></div>
          <div className="pad">
            {role.permissions.length > 0 ? (
              role.permissions.slice(0, 12).map((perm: { module: string; action: string; resource?: string; allowed: boolean }, i: number) => (
                <div key={i} className="prefrow">
                  <span style={{ fontSize: 13 }}>{perm.module} · {perm.action}</span>
                  <span className={`pill ${perm.allowed ? "good" : "mut"}`}>{perm.allowed ? "On" : "Off"}</span>
                </div>
              ))
            ) : (
              <div className="empty-state" style={{ paddingTop: 32 }}><div>🔑</div><h4>No rules</h4><p>Permission rules will appear here.</p></div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
