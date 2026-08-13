import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { PageHeader } from "../../../../_components/ds";
import { formatIndianDate } from "@/lib/formatters";
import { getAdminRoleById } from "../../../../_data/loaders";
import { Breadcrumb } from "../../Breadcrumb";
import { PermissionGrid } from "./PermissionGrid";
import { EditRoleButton } from "./EditRoleButton";

export default async function AdminRoleDetailPage({ params }: { params: { id: string } }) {
  const { data: role, source } = await getAdminRoleById(params.id);

  if (!role) {
    return (
      <main className="page-main wrap" aria-labelledby="page-heading">
        <Breadcrumb items={[{ label: "Tenant Admin", href: "/tenant-admin" }, { label: "Manage Roles", href: "/tenant-admin/roles" }, { label: "Not found" }]} />
        <a href="/tenant-admin/roles" className="back">← Back</a>
        <p style={{ color: "var(--civitas-color-text-muted)", marginTop: 16 }}>Role not found.</p>
      </main>
    );
  }

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <Breadcrumb items={[{ label: "Tenant Admin", href: "/tenant-admin" }, { label: "Manage Roles", href: "/tenant-admin/roles" }, { label: role.name }]} />
      <PageHeader
        back="/tenant-admin/roles"
        title={role.name}
        subtitle={role.description ?? "Role permissions and user assignments"}
        actions={
          <>
            {role.isSystemRole
              ? <span className="pill info">System role</span>
              : <span className="pill mut">Custom role</span>}
            {!role.isSystemRole && <EditRoleButton roleId={role.id} name={role.name} description={role.description} />}
            {source === "error" && <DataSourceBadge source={source} />}
          </>
        }
      />
      <div className="grid g-main" style={{ alignItems: "start" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <PermissionGrid roleId={role.id} permissions={role.permissions} editable={!role.isSystemRole} />
        </div>
        <div className="card">
          <div className="card-h"><h3>Details</h3></div>
          <div className="fields">
            <div className="fld"><div className="l">Name</div><div className="v">{role.name}</div></div>
            <div className="fld"><div className="l">Type</div><div className="v">{role.isSystemRole ? "System" : "Custom"}</div></div>
            <div className="fld"><div className="l">Users assigned</div><div className="v">{role.userCount}</div></div>
            <div className="fld"><div className="l">Created</div><div className="v">{formatIndianDate(role.createdAt)}</div></div>
            {role.description && <div className="fld"><div className="l">Description</div><div className="v">{role.description}</div></div>}
            <div className="fld"><div className="l">Permission rules</div><div className="v">{role.permissions.length}</div></div>
          </div>
        </div>
      </div>
    </main>
  );
}
