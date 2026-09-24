import { PageHeader, StatusPill, EmptyState, RefreshErrorState } from "../../../../_components/ds";
import { formatIndianDate } from "@/lib/formatters";
import { toHumanError } from "@/lib/messages";
import { getAdminUserById } from "../../../../_data/loaders";
import { Breadcrumb } from "../../Breadcrumb";
import { UserSecurityActions } from "./UserSecurityActions";
import { UserSessionsTable } from "./UserSessionsTable";

export default async function AdminUserDetailPage({ params }: { params: { id: string } }) {
  const { data: user, source } = await getAdminUserById(params.id);

  // UX-013: `!user` used to be the only check here, so a real fetch failure
  // (getAdminUserById resolves { data: null, source: "error" } on any
  // failure, per fetchJson's contract) rendered pixel-identical to a
  // genuine "no such user" 404 -- both showed "User not found". Check
  // `source` first so an outage gets a retry-able error state instead of
  // looking like the user was deleted.
  if (source === "error") {
    return (
      <div className="page-main wrap" aria-labelledby="page-heading">
        <Breadcrumb items={[{ label: "Tenant Admin", href: "/tenant-admin" }, { label: "Users", href: "/tenant-admin/users" }, { label: "Error" }]} />
        <RefreshErrorState error={toHumanError("load", { area: "user" })} backHref="/tenant-admin/users" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="page-main wrap" aria-labelledby="page-heading">
        <Breadcrumb items={[{ label: "Tenant Admin", href: "/tenant-admin" }, { label: "Users", href: "/tenant-admin/users" }, { label: "Not found" }]} />
        <EmptyState icon="👤" title="User not found" message="This user may have been removed or the ID is invalid." />
      </div>
    );
  }

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      <Breadcrumb items={[{ label: "Tenant Admin", href: "/tenant-admin" }, { label: "Users", href: "/tenant-admin/users" }, { label: user.name ?? user.email }]} />
      <PageHeader
        back="/tenant-admin/users"
        title={user.name ?? user.email}
        subtitle={user.email}
        actions={<UserSecurityActions userId={user.id} />}
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
    </div>
  );
}
