import { cache } from "../../shared/infra.js";
import { RESOURCE } from "../../topics.js";
import * as repo from "./repo.js";
import type { RoleView } from "./domain.js";

export async function getRole(tenantId: string, id: string): Promise<RoleView | null> {
  return cache.getOrLoad<RoleView>(cache.makeKey(tenantId, RESOURCE.role, id), () => repo.findRoleById(id));
}

export async function listRoles(tenantId: string): Promise<RoleView[]> {
  return cache.getOrLoad<RoleView[]>(
    cache.makeKey(tenantId, `${RESOURCE.role}_list`, tenantId),
    () => repo.findRolesByTenant(tenantId)
  ) as Promise<RoleView[]>;
}
