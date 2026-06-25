import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { PageHeader, StatCard } from "../../../_components/ds";
import { getAdminRoles } from "../../../_data/loaders";
import { Breadcrumb } from "../Breadcrumb";
import { RolesTable } from "./RolesTable";

export default async function AdminRolesPage() {
  const { data: roles, source } = await getAdminRoles();

  const total = roles.length;
  const systemRoles = roles.filter((r) => r.isSystemRole).length;
  const customRoles = roles.filter((r) => !r.isSystemRole).length;
  const totalAssigned = roles.reduce((sum, r) => sum + r.userCount, 0);

  return (
    <div className="wrap">
      <Breadcrumb items={[{ label: "Tenant Admin", href: "/tenant-admin" }, { label: "Manage Roles" }]} />
      <PageHeader
        back="/tenant-admin"
        title="Manage Roles"
        subtitle="Role definitions and permission assignment for this tenant."
        actions={<button type="button" className="btn ghost">Export</button>}
      />
      <div className="grid g-4" style={{ marginBottom: 18 }}>
        <StatCard icon="🔑" iconBg="#f1f5f9" label="Total Roles" value={total} />
        <StatCard icon="⚙️" iconBg="#eff6ff" label="System Roles" value={systemRoles} />
        <StatCard icon="✏️" iconBg="#ecfdf3" label="Custom Roles" value={customRoles} />
        <StatCard icon="👥" iconBg="#fffaeb" label="Assignments" value={totalAssigned} />
      </div>
      {source === "error" && <DataSourceBadge source={source} />}
      <RolesTable
        roles={roles.map((r) => ({
          id: r.id,
          name: r.name,
          description: r.description,
          isSystemRole: r.isSystemRole,
          userCount: r.userCount,
        }))}
      />
    </div>
  );
}
