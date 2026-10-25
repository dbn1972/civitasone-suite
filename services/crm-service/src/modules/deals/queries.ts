import { cache } from "../../shared/infra.js";
const RESOURCE = "deal";
import * as repo from "./repo.js";
import type { DealView } from "./schema.js";

export async function getDeal(id: string, tenantId: string): Promise<DealView | null> {
  return cache.getOrLoad<DealView>(
    cache.makeKey(tenantId, RESOURCE, id),
    () => repo.findById(id, tenantId)
  );
}

export async function listDeals(
  tenantId: string,
  limit: number,
  offset: number,
  pipelineId?: string,
  ids?: readonly string[],
  visibleTo?: string,
): Promise<{ data: DealView[]; pagination: { hasMore: boolean; pageSize: number; total: number; cursor?: string } }> {
  // A by-id lookup is small and bounded (<= 50 ids) and its key space is unbounded, so it
  // skips the list cache and always reads the live rows.
  if (ids) {
    const [rows, total] = await Promise.all([
      repo.listByTenant(tenantId, limit, offset, pipelineId, ids),
      repo.countByTenant(tenantId, pipelineId, ids),
    ]);
    return {
      data: rows,
      pagination: {
        hasMore: offset + rows.length < total,
        pageSize: limit,
        total,
        ...(rows.length ? { cursor: String(offset + rows.length) } : {}),
      },
    };
  }
  return cache.listOrLoad(tenantId, RESOURCE, `list:${limit}:${offset}:${pipelineId ?? "*"}:v${visibleTo ?? ""}`, async () => {
    const [rows, total] = await Promise.all([
      repo.listByTenant(tenantId, limit, offset, pipelineId, undefined, visibleTo),
      // GAP-CRM-PIPELINE-05: the tenant-wide (or pipeline-scoped) live-deal total,
      // so the board shows "N of M" instead of guessing truncation from a full page.
      repo.countByTenant(tenantId, pipelineId, undefined, visibleTo),
    ]);
    return {
      data: rows,
      pagination: {
        hasMore: offset + rows.length < total,
        pageSize: limit,
        total,
        ...(rows.length ? { cursor: String(offset + rows.length) } : {}),
      },
    };
  });
}
