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


// Returns whether a matching document was actually found and updated, so the
// route can return a real 404 instead of a fake 200 for a bad/foreign id
// (see repo.ts::updateStatusDirect for the full history of this fix).
//
// Deliberately NOT invalidating the list cache here: an earlier version of
// this fix added an unguarded cache.invalidateResource(tenantId, RESOURCE)
// call, and independent review found it introduced three separate new
// problems -- (1) an unhandled cache exception would turn an
// already-committed write into a reported 500, the same "caller is lied to"
// shape as the bug this fix closes, just inverted; (2) RESOURCE="document"
// is an unscoped prefix of the versions module's "document-version", so
// prefix-based invalidation would also wipe that tenant's cached version
// history on every publish/unpublish; (3) it didn't actually match the
// create path's own invalidation strategy (cache.put), so it added a third,
// inconsistent cache-write shape rather than following an established one.
// Left as a known, pre-existing staleness gap (present before this PR too,
// since the write never really happened before) for whoever addresses cache
// invalidation for this module properly.
export async function setDocumentStatus(tenantId: string, id: string, status: string): Promise<boolean> {
  return repo.updateStatusDirect(tenantId, id, status);
}
