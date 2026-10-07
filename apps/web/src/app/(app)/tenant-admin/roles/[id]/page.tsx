import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { PageHeader, Card, RefreshErrorState } from "../../../../_components/ds";
import { formatIndianDate } from "@/lib/formatters";
import { toHumanError } from "@/lib/messages";
import { getAdminRoleById } from "../../../../_data/loaders";
import { notFound } from "next/navigation";
import { Breadcrumb } from "../../Breadcrumb";
import { PermissionGrid } from "./PermissionGrid";
import { EditRoleButton } from "./EditRoleButton";

export default async function AdminRoleDetailPage({ params }: { params: { id: string } }) {
  const result = await getAdminRoleById(params.id);
  const { data: role, source } = result;

  // GAP-TENANT-ADMIN-ROLES-DETAIL-03: a failed fetch (5xx/network) must NOT look
  // like a deleted role. Only a genuine 404 renders the not-found page; any
  // other error shows a retryable error card.
  if (!role) {
    if (result.status === 404) notFound();
    if (source === "error") {
      return (
        <div className="page-main wrap">
          <Breadcrumb items={[{ label: "Tenant Admin", href: "/tenant-admin" }, { label: "Manage Roles", href: "/tenant-admin/roles" }, { label: "Unavailable" }]} />
          <PageHeader back="/tenant-admin/roles" title="Role" subtitle="" />
          <Card title="Role" padding>
            <RefreshErrorState error={toHumanError("load", { area: "role" })} backHref="/tenant-admin/roles" />
          </Card>
        </div>
      );
    }
    // No data, no error status: treat as not found.
    notFound();
  }

  return (
    <div className="page-main wrap">
      <Breadcrumb items={[{ label: "Tenant Admin", href: "/tenant-admin" }, { label: "Manage Roles", href: "/tenant-admin/roles" }, { label: role.name }]} />
      <PageHeader
        back="/tenant-admin/roles"
        title={role.name}
        // GAP-TENANT-ADMIN-ROLES-DETAIL-05: the fallback no longer promises
        // "user assignments" the page doesn't render — just "Role permissions".
        subtitle={role.description ?? "Role permissions"}
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
    </div>
  );
}
