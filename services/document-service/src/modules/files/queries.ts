import { cache } from "../../shared/infra.js";
import { RESOURCE } from "../../topics.js";
import * as repo from "./repo.js";
import type { FileView } from "./schema.js";

export async function listFiles(
  tenantId: string,
  limit: number,
  offset: number,
): Promise<{ data: FileView[]; pagination: { hasMore: boolean; pageSize: number } }> {
  return cache.listOrLoad(tenantId, RESOURCE, `list:${limit}:${offset}`, async () => {
    const rows = await repo.listByTenant(tenantId, limit, offset);
    return { data: rows, pagination: { hasMore: rows.length === limit, pageSize: limit } };
  });
}

export async function listFilesByFolder(tenantId: string, folderId: string | null, limit: number, offset: number) {
  const rows = await repo.listByFolder(tenantId, folderId, limit, offset);
  return { data: rows, pagination: { hasMore: rows.length === limit, pageSize: limit } };
}

export async function getFile(tenantId: string, id: string): Promise<FileView | null> {
  const key = cache.makeKey(tenantId, RESOURCE, id);
  return cache.getOrLoad<FileView>(key, () => repo.getById(tenantId, id));
}

export async function searchFiles(tenantId: string, query: string, limit: number): Promise<FileView[]> {
  return repo.searchByTenant(tenantId, query, limit);
}
