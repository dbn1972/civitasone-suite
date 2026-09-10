import * as repo from "./repo.js";
import type { RoleView, PermissionView, EffectiveAccess } from "./domain.js";
import { scopedRead } from "../../shared/db.js";

export async function listRoles(tenantId: string, limit: number, offset: number): Promise<RoleView[]> {
  return repo.listRoles(tenantId, limit, offset);
}
export async function listPermissions(tenantId: string, limit: number, offset: number): Promise<PermissionView[]> {
  return repo.listPermissions(tenantId, limit, offset);
}
// COMP-013 fix-up: these two used the raw `db` export directly instead of
// `scopedRead`, so the read ran with no app.tenant_id GUC set -- under this
// service's NOBYPASSRLS role, RLS fail-closes to zero rows regardless of the
// app-layer tenantId filter (see shared/db.ts's scopedRead doc comment).
// GET /identity/rbac/roles/:id always 404'd for a real, existing role, live-
// verified against the running identity-service before this fix (curl
// confirmed a known-good role id, present in the DB, coming back 404). This
// silently broke the per-role detail fetch both COMP-004 (admin/roles) and
// COMP-013 (platform-admin/roles) depend on to load a role's current grants.
export async function getRole(tenantId: string, id: string): Promise<RoleView | null> {
  return scopedRead((tx) => repo.findRoleById(tx, tenantId, id));
}
export async function rolePermissionKeys(tenantId: string, roleId: string): Promise<string[]> {
  return scopedRead((tx) => repo.permissionKeysForRole(tx, tenantId, roleId));
}
export async function effectiveAccess(tenantId: string, userId: string): Promise<EffectiveAccess> {
  return repo.effectiveAccess(tenantId, userId);
}
