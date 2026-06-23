import { cache } from "../../shared/infra.js";
import { RESOURCE } from "../../topics.js";
import * as repo from "./repo.js";
import type { RoleView, PermissionView } from "./domain.js";

export async function getRole(tenantId: string, id: string): Promise<RoleView | null> {
  return cache.getOrLoad<RoleView>(cache.makeKey(tenantId, RESOURCE.role, id), () => repo.findRoleById(id));
}

export async function listRoles(tenantId: string): Promise<RoleView[]> {
  return cache.getOrLoad<RoleView[]>(
    cache.makeKey(tenantId, `${RESOURCE.role}_list`, tenantId),
    () => repo.findRolesByTenant(tenantId)
  ) as Promise<RoleView[]>;
}

export async function listRolePermissions(tenantId: string, roleId: string): Promise<PermissionView[]> {
  return cache.getOrLoad<PermissionView[]>(
    cache.makeKey(tenantId, `${RESOURCE.role}_perms`, roleId),
    () => repo.findPermsByRole(roleId)
  ) as Promise<PermissionView[]>;
}
