import { getAdminRolesList, getAdminPermissionsList } from "@/app/_data/loaders";
import { RolesPermissionsManager } from "./RolesPermissionsManager";

// COMP-004: this page used to render a Role Permissions Matrix built
// entirely from an invented taxonomy — 9 hardcoded ROLES and 7 hardcoded
// "permission groups" (HR Read/Write, Payroll Read/Write, etc.) that have
// no correspondence to identity-service's real RBAC permission keys, saved
// via a PUT to /v1/admin/roles/permissions-matrix that doesn't exist
// anywhere in admin-service. The real backend (gap/routes.ts) has no bulk
// "replace the whole matrix" command — only per-role read (GET
// /v1/admin/roles/:id, added alongside this fix) and a diff-and-apply PATCH
// /v1/admin/roles/:id/permissions ({ permissionKeys: string[] }, the FULL
// desired set for that one role). So this is now a per-role editor: pick a
// role, see its real current permissions, toggle, save — one role at a
// time, matching what the backend actually supports, rather than pretending
// a matrix-wide bulk save exists. System roles (super_admin, platform_admin
// — isSystem: true from identity-service) are read-only, since there's also
// no update-role-metadata command for them (see the 501 on PATCH
// /v1/admin/roles/:id).
export default async function RolePermissionsPage() {
  const [{ data: roles, source: rolesSource }, { data: permissions, source: permsSource }] = await Promise.all([
    getAdminRolesList(),
    getAdminPermissionsList(),
  ]);
  const source = rolesSource === "error" || permsSource === "error" ? "error" : "api";
  return <RolesPermissionsManager roles={roles} permissions={permissions} source={source} />;
}
