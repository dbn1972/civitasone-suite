/** queues query handlers (READ PATH) — tenant-scoped read-through cache. */
import { cache } from "../../shared/infra.js";
import { QUEUE_RESOURCE } from "../../topics.js";
import * as repo from "./repo.js";
import type { QueueView } from "./schema.js";

export async function getQueue(id: string, tenantId: string): Promise<QueueView | null> {
  return cache.getOrLoad<QueueView>(cache.makeKey(tenantId, QUEUE_RESOURCE, id), () => repo.findById(id, tenantId));
}

export async function listQueues(
  tenantId: string,
  limit: number,
  offset: number,
): Promise<{ data: QueueView[]; pagination: { hasMore: boolean; pageSize: number; cursor?: string } }> {
  return cache.listOrLoad(tenantId, QUEUE_RESOURCE, `list:${limit}:${offset}`, async () => {
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
