import { cache } from "../../shared/infra.js";
import * as repo from "./repo.js";
import type { PipelineView } from "./schema.js";

const RESOURCE = "pipeline";

export async function getPipeline(id: string, tenantId: string): Promise<PipelineView | null> {
  return cache.getOrLoad<PipelineView>(
    cache.makeKey(tenantId, RESOURCE, id),
    () => repo.findById(id, tenantId),
  );
}

export async function listPipelines(
  tenantId: string,
  limit: number,
  offset: number,
): Promise<{ data: PipelineView[]; pagination: { hasMore: boolean; pageSize: number; cursor?: string } }> {
  return cache.listOrLoad(tenantId, RESOURCE, `list:${limit}:${offset}`, async () => {
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
