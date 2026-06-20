import { cache } from "../../shared/infra.js";
import { RESOURCE } from "../../topics.js";
import * as repo from "./repo.js";
import type { ItemView } from "./schema.js";

export async function getItem(id: string, tenantId: string): Promise<ItemView | null> {
  return cache.getOrLoad<ItemView>(cache.makeKey(tenantId, RESOURCE, id), () => repo.findById(id, tenantId));
}

export async function listItems(tenantId: string, limit: number, offset: number) {
  return cache.listOrLoad(tenantId, RESOURCE, `list:${limit}:${offset}`, async () => {
    const rows = await repo.listByTenant(tenantId, limit, offset);
    return {
      data: rows,
      pagination: { hasMore: rows.length === limit, pageSize: limit, ...(rows.length ? { cursor: String(offset + rows.length) } : {}) },
    };
  });
}
