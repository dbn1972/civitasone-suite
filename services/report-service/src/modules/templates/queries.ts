/**
 * Query handlers (READ PATH) — read-through cache for templates.
 */
import { cache } from "../../shared/infra.js";
import * as repo from "./repo.js";
import type { TemplateView } from "./schema.js";

const RESOURCE = "template";

export async function getTemplate(tenantId: string, id: string): Promise<TemplateView | null> {
  return cache.getOrLoad(
    cache.makeKey(tenantId, RESOURCE, id),
    () => repo.findById(id, tenantId),
  );
}

export async function listTemplates(
  tenantId: string,
  limit: number,
  offset: number,
): Promise<{ data: TemplateView[]; pagination: { hasMore: boolean; pageSize: number; cursor?: string } }> {
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

export async function getTemplateCount(tenantId: string): Promise<number> {
  return repo.countByTenant(tenantId);
}
