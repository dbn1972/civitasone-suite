import { cache } from "../../shared/infra.js";
import { RESOURCE } from "../../topics.js";
import * as repo from "./repo.js";
import { clearanceScope } from "./clearance.js";
import type { DocumentView } from "./schema.js";

export async function searchDocuments(
  tenantId: string,
  query: string,
  category: string | undefined,
  limit: number,
  levels?: repo.Clearance,
): Promise<DocumentView[]> {
  const rows = await repo.searchByTenant(tenantId, query, category, limit, levels);
  return rows;
}

export async function listDocuments(
  tenantId: string,
  limit: number,
  offset: number,
  levels: repo.Clearance = null,
): Promise<{ data: DocumentView[]; pagination: { hasMore: boolean; pageSize: number; cursor?: string } }> {
  // The clearance scope is part of the cache key: a list cached for an
  // admin (all levels) must never be served to an uncleared user.
  return cache.listOrLoad(tenantId, RESOURCE, `list:${limit}:${offset}:${clearanceScope(levels ?? null)}`, async () => {
    const rows = await repo.listByTenant(tenantId, limit, offset, levels);
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

export async function getDocumentById(tenantId: string, id: string, levels?: repo.Clearance): Promise<DocumentView | null> {
  return repo.getById(tenantId, id, levels);
}

/**
 * GAP2-KNOWLEDGE-RECORDS-01: records projection joined to applied retention
 * policy (see repo.listRecords). Not cached — retention fields are derived
 * and the Records view is a low-traffic compliance screen.
 */
export async function listRecords(
  tenantId: string,
  limit: number,
  offset: number,
  levels?: repo.Clearance,
): Promise<repo.RecordProjection[]> {
  return repo.listRecords(tenantId, limit, offset, levels);
}

/**
 * GAP2-KNOWLEDGE-DASHBOARD-CAP-01: repository-wide document aggregate for the
 * dashboard StatCards + category chart (not page-capped).
 */
export async function summarizeDocuments(tenantId: string, levels?: repo.Clearance): Promise<repo.DocumentsSummary> {
  return repo.summarize(tenantId, levels);
}

export async function listDocumentsByCategory(tenantId: string, categoryId: string, limit: number, offset: number, levels?: repo.Clearance): Promise<DocumentView[]> {
  return repo.listByCategory(tenantId, categoryId, limit, offset, levels);
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
