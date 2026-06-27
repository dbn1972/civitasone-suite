import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { PageHeader, StatusPill, EmptyState } from "../../../../_components/ds";
import { formatIndianDate } from "@/lib/formatters";
import { getAdminUserById } from "../../../../_data/loaders";
import { Breadcrumb } from "../../Breadcrumb";
import { UserSecurityActions } from "./UserSecurityActions";
import { UserSessionsTable } from "./UserSessionsTable";

export default async function AdminUserDetailPage({ params }: { params: { id: string } }) {
  const { data: user, source } = await getAdminUserById(params.id);

  if (!user) {
    return (
      <main className="page-main wrap" aria-labelledby="page-heading">
        <Breadcrumb items={[{ label: "Tenant Admin", href: "/tenant-admin" }, { label: "Users", href: "/tenant-admin/users" }, { label: "Not found" }]} />
        <EmptyState icon="👤" title="User not found" message="This user may have been removed or the ID is invalid." />
      </main>
    );
  }

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <Breadcrumb items={[{ label: "Tenant Admin", href: "/tenant-admin" }, { label: "Users", href: "/tenant-admin/users" }, { label: user.name ?? user.email }]} />
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
              <div className="fld"><div className="l">Last login</div><div className="v">{user.lastLoginAt ? formatIndianDate(user.lastLoginAt) : "—"}</div></div>
              <div className="fld"><div className="l">Created</div><div className="v">{formatIndianDate(user.createdAt)}</div></div>
            </div>
          </div>
        </div>
        <div className="card">
          <div className="card-h"><h3>Active sessions</h3></div>
          {user.sessions.length === 0 ? (
            <EmptyState icon="🖥️" title="No sessions" message="No active sessions for this user." />
          ) : (
            <UserSessionsTable sessions={user.sessions} />
          )}
        </div>
      </div>
    </main>
  );
}
