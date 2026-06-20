/**
 * Query handlers (READ PATH).
 * Rule (CLAUDE.md §6): always read-through the cache; only fall back to Postgres on a miss.
 */
import { cache } from "../../shared/infra.js";
import { RESOURCE } from "../../topics.js";
import * as repo from "./repo.js";
import type { ContactView } from "./schema.js";

export async function getContact(id: string, tenantId: string): Promise<ContactView | null> {
  return cache.getOrLoad<ContactView>(
    cache.makeKey(tenantId, RESOURCE, id),
    () => repo.findById(id, tenantId)
  );
}

export async function listContacts(
  tenantId: string,
  limit: number,
  offset: number
): Promise<{ data: ContactView[]; pagination: { hasMore: boolean; pageSize: number; cursor?: string } }> {
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
