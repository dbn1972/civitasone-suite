import { cache } from "../../shared/infra.js";
import { RESOURCE } from "../../topics.js";
import * as repo from "./repo.js";
import type { UserView } from "./domain.js";

export async function getUser(tenantId: string, id: string): Promise<UserView | null> {
  const view = await cache.getOrLoad<UserView>(
    cache.makeKey(tenantId, RESOURCE.user, id),
    () => repo.findById(tenantId, id),
  );
  // Defense in depth: never return a row belonging to another tenant.
  if (view && view.tenantId !== tenantId) return null;
  return view;
}

export async function listUsers(tenantId: string, limit: number, offset: number): Promise<UserView[]> {
  return cache.getOrLoad<UserView[]>(
    cache.makeKey(tenantId, `${RESOURCE.user}_list`, `${limit}:${offset}`),
    () => repo.findByTenantId(tenantId, limit, offset)
  ) as Promise<UserView[]>;
}

/** Not cached: a filtered, paged search must reflect the directory as it is now. */
export async function searchUsers(tenantId: string, f: repo.UserSearch) {
  return repo.search(tenantId, f);
}
