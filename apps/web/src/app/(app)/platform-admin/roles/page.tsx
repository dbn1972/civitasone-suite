import { PageHeader, StatCard } from "@/app/_components/ds";
import { Breadcrumb } from "../Breadcrumb";
import { getAdminRolesList, getAdminPermissionsList } from "@/app/_data/loaders";
import { RolePermissionsMatrix } from "./RolePermissionsMatrix";

// COMP-013: this page used to render a Roles & Permissions matrix built
// entirely from an invented taxonomy -- 9 hardcoded ROLES and a hardcoded
// DEFAULTS module x action baseline -- saved via a PUT to
// /api/proxy/v1/admin/role-permissions whose failure was swallowed by
// `.catch(() => null)`, so the page always reported success even when the
// request errored or the route didn't exist. It now loads the real role and
// permission catalogue from identity-service's RBAC store (the same
// getAdminRolesList/getAdminPermissionsList loaders and admin-service routes
// COMP-004 wired for admin/roles), and RolePermissionsMatrix derives the
// module/action grid from the real permission keys instead of a fabricated
// constant.
export default async function PlatformAdminRolesPage() {
  const [{ data: roles, source: rolesSource }, { data: permissions, source: permsSource }] = await Promise.all([
    getAdminRolesList(),
    getAdminPermissionsList(),
  ]);
  const source = rolesSource === "error" || permsSource === "error" ? "error" : "api";

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <Breadcrumb items={[{ label: "Platform Admin", href: "/platform-admin" }, { label: "Roles & Permissions" }]} />
      <PageHeader
        back="/platform-admin"
        title="Roles & Permissions"
        subtitle="Per-role permission matrix with SoD enforcement (GFR 2017). Toggle cells to grant or revoke. System roles are read-only."
      />
      <div className="grid g-4" style={{ marginBottom: 18 }}>
        <StatCard icon="🔑" iconBg="#eff6ff" label="Platform roles" value={roles.length} />
        <StatCard icon="🛡️" iconBg="#fffaeb" label="SoD constraints" value="Active" />
      </div>
      <RolePermissionsMatrix roles={roles} permissions={permissions} source={source} />
    </main>
  );
}
