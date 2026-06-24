import * as repo from "./repo.js";
import type { RoleView, PermissionView, EffectiveAccess } from "./domain.js";
import { db } from "../../shared/db.js";

export async function listRoles(tenantId: string, limit: number, offset: number): Promise<RoleView[]> {
  return repo.listRoles(tenantId, limit, offset);
}
export async function listPermissions(tenantId: string, limit: number, offset: number): Promise<PermissionView[]> {
  return repo.listPermissions(tenantId, limit, offset);
}
export async function getRole(tenantId: string, id: string): Promise<RoleView | null> {
  return repo.findRoleById(db, tenantId, id);
}
export async function rolePermissionKeys(tenantId: string, roleId: string): Promise<string[]> {
  return repo.permissionKeysForRole(db, tenantId, roleId);
}
export async function effectiveAccess(tenantId: string, userId: string): Promise<EffectiveAccess> {
  return repo.effectiveAccess(tenantId, userId);
}
