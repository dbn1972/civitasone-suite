import { cache } from "../../shared/infra.js";
import * as repo from "./repo.js";
import type { AgentScriptView } from "./schema.js";

const RESOURCE = "agent_script";

export async function getAgentScript(id: string, tenantId: string): Promise<AgentScriptView | null> {
  return cache.getOrLoad<AgentScriptView>(
    cache.makeKey(tenantId, RESOURCE, id),
    () => repo.findById(id, tenantId),
  );
}

export async function listAgentScripts(
  tenantId: string,
  limit: number,
  offset: number,
  productCode?: string,
  language?: string,
): Promise<{ data: AgentScriptView[]; pagination: { hasMore: boolean; pageSize: number; cursor?: string } }> {
  return cache.listOrLoad(tenantId, RESOURCE, `list:${limit}:${offset}:${productCode ?? ""}:${language ?? ""}`, async () => {
    const rows = await repo.listByTenant(tenantId, limit, offset, productCode, language);
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
