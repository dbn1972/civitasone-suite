import { cache } from "../../shared/infra.js";
import { RESOURCE } from "../../topics.js";
import * as repo from "./repo.js";
import type { ContactView, ContactDetailView } from "./schema.js";
import type { ListFilters } from "./repo.js";

export async function getContact(id: string, tenantId: string): Promise<ContactView | null> {
  return cache.getOrLoad<ContactView>(
    cache.makeKey(tenantId, RESOURCE, id),
    () => repo.findById(id, tenantId),
  );
}

export async function getContactDetail(id: string, tenantId: string): Promise<ContactDetailView | null> {
  return repo.findDetail(id, tenantId);
}

export async function listContacts(
  tenantId: string,
  limit: number,
  offset: number,
  filters: ListFilters = {},
): Promise<{ data: ContactView[]; pagination: { hasMore: boolean; pageSize: number; cursor?: string } }> {
  const cacheKey = `list:${limit}:${offset}:${filters.search ?? ""}:${filters.leadStatus ?? ""}:${filters.segment ?? "all"}:${filters.ownerId ?? ""}`;
  return cache.listOrLoad(tenantId, RESOURCE, cacheKey, async () => {
    const rows = await repo.listByTenant(tenantId, limit, offset, filters);
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

export async function exportContacts(tenantId: string): Promise<ContactView[]> {
  return repo.exportAll(tenantId);
}

export async function listAccounts(tenantId: string) {
  return repo.listAccounts(tenantId);
}
