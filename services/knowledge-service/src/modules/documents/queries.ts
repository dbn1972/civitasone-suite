import { cache } from "../../shared/infra.js";
import { RESOURCE } from "../../topics.js";
import * as repo from "./repo.js";
import type { DocumentView } from "./schema.js";

export async function searchDocuments(
  tenantId: string,
  query: string,
  category: string | undefined,
  limit: number,
): Promise<DocumentView[]> {
  const rows = await repo.searchByTenant(tenantId, query, category, limit);
  return rows;
}

export async function listDocuments(
  tenantId: string,
  limit: number,
  offset: number
): Promise<{ data: DocumentView[]; pagination: { hasMore: boolean; pageSize: number; cursor?: string } }> {
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

export async function getDocumentById(tenantId: string, id: string): Promise<DocumentView | null> {
  return repo.getById(tenantId, id);
}

export async function listDocumentsByCategory(tenantId: string, categoryId: string, limit: number, offset: number): Promise<DocumentView[]> {
  return repo.listByCategory(tenantId, categoryId, limit, offset);
}


export async function setDocumentStatus(tenantId: string, id: string, status: string): Promise<void> {
  await repo.updateStatusDirect(tenantId, id, status);
}
