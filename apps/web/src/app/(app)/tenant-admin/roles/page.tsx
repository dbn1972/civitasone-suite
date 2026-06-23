import Link from "next/link";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { PageHeader, StatCard } from "../../../_components/ds";
import { getAdminRoles } from "../../../_data/loaders";

export default async function AdminRolesPage() {
  const { data: roles, source } = await getAdminRoles();

  const total = roles.length;
  const systemRoles = roles.filter((r) => r.isSystemRole).length;
  const customRoles = roles.filter((r) => !r.isSystemRole).length;
  const totalAssigned = roles.reduce((sum, r) => sum + r.userCount, 0);

  return (
    <div className="wrap">
      <PageHeader
        back="/tenant-admin"
        title="Manage Roles"
        subtitle="Role definitions and permission assignment for this tenant."
        actions={
          <>
            <button className="btn ghost">Export</button>
            <button className="btn primary">+ New Role</button>
          </>
        }
      />
      <div className="grid g-4" style={{ marginBottom: 18 }}>
        <StatCard icon="🔑" iconBg="#f1f5f9" label="Total Roles" value={total} />
        <StatCard icon="⚙️" iconBg="#eff6ff" label="System Roles" value={systemRoles} />
        <StatCard icon="✏️" iconBg="#ecfdf3" label="Custom Roles" value={customRoles} />
        <StatCard icon="👥" iconBg="#fffaeb" label="Assignments" value={totalAssigned} />
      </div>
      {source === "error" && <DataSourceBadge source={source} />}
      <div className="grid g-2" style={{ marginTop: 18 }}>
        <div className="card">
          <div className="card-h">
            <h3>Role definitions</h3>
            <div className="seg"><span className="on">All</span><span>System</span><span>Custom</span></div>
          </div>
          <table className="tbl">
            <thead>
              <tr>
                <th>Name</th>
                <th>Description</th>
                <th>Users</th>
                <th>Type</th>
              </tr>
            </thead>
            <tbody>
              {roles.map((role) => (
                <tr key={role.id}>
                  <td>
                    <Link href={`/tenant-admin/roles/${role.id}`} className="lnk">
                      {role.name}
                    </Link>
                  </td>
                  <td style={{ maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {role.description ?? "—"}
                  </td>
                  <td>{role.userCount}</td>
                  <td>
                    {role.isSystemRole
                      ? <span className="pill info">System</span>
                      : <span className="pill mut">Custom</span>}
                  </td>
                </tr>
              ))}
              {roles.length === 0 && (
                <tr><td colSpan={4}><div className="empty-state"><div>🔑</div><h4>No roles</h4><p>Role definitions will appear here once configured.</p></div></td></tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="card">
          <div className="card-h"><h3>Permissions overview</h3></div>
          <div className="pad" style={{ color: "#667085", fontSize: 13 }}>
            {roles.length > 0 ? (
              <div>
                {roles.slice(0, 8).map((role) => (
                  <div key={role.id} className="prefrow">
                    <span>{role.name}</span>
                    <span className="pill info">{role.userCount} users</span>
                  </div>
                ))}
                {roles.length > 8 && (
                  <div style={{ padding: "8px 0", color: "#98a2b3", fontSize: 12 }}>+{roles.length - 8} more roles</div>
                )}
              </div>
            ) : (
              <div className="empty-state"><div>🔑</div><h4>No roles</h4><p>Select a role to view its permissions.</p></div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
