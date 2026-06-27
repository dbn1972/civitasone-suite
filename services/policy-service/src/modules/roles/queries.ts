import { cache } from "../../shared/infra.js";
import { RESOURCE } from "../../topics.js";
import * as repo from "./repo.js";
import type { RoleView, PermissionView } from "./domain.js";

export async function getRole(tenantId: string, id: string): Promise<RoleView | null> {
  const view = await cache.getOrLoad<RoleView>(cache.makeKey(tenantId, RESOURCE.role, id), () => repo.findRoleById(id, tenantId));
  // Defense-in-depth: guard against a cross-tenant cache hit.
  return view && view.tenantId === tenantId ? view : null;
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
    () => repo.findPermsByRole(roleId, tenantId)
  ) as Promise<PermissionView[]>;
}
