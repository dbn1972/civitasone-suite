import { cache } from "../../shared/infra.js";
import { RESOURCE } from "../../topics.js";
import * as repo from "./repo.js";
import type { SessionView } from "./domain.js";

export async function getSession(tenantId: string, id: string): Promise<SessionView | null> {
  return cache.getOrLoad<SessionView>(cache.makeKey(tenantId, RESOURCE.session, id), () => repo.findById(id));
}

export async function listSessions(tenantId: string, limit: number): Promise<SessionView[]> {
  const rows = await cache.getOrLoad(
    cache.makeKey(tenantId, RESOURCE.session, `list:${limit}`),
    () => repo.listByTenant(tenantId, limit),
  );
  return rows ?? [];
}
