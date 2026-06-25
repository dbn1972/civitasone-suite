/** agents query handlers (READ PATH) — tenant-scoped read-through cache. */
import { cache } from "../../shared/infra.js";
import { AGENT_RESOURCE } from "../../topics.js";
import * as repo from "./repo.js";
import type { AgentView } from "./schema.js";

export async function getAgent(id: string, tenantId: string): Promise<AgentView | null> {
  return cache.getOrLoad<AgentView>(cache.makeKey(tenantId, AGENT_RESOURCE, id), () => repo.findById(id, tenantId));
}

export async function listAgents(
  tenantId: string,
  limit: number,
  offset: number,
): Promise<{ data: AgentView[]; pagination: { hasMore: boolean; pageSize: number; cursor?: string } }> {
  return cache.listOrLoad(tenantId, AGENT_RESOURCE, `list:${limit}:${offset}`, async () => {
    const rows = await repo.listByTenant(tenantId, limit, offset);
    return {
      data: rows,
      pagination: {
        hasMore: rows.length === limit,
        pageSize: limit,
        ...(rows.length ? { cursor: String(offset + rows.length) } : {}),
      },
    };
  });
}
