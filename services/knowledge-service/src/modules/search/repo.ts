import { eq, and, sql } from "drizzle-orm";
import { createSearchEngine, type SearchEngine, type SearchResult as EngineResult } from "@civitasone/search";
import { db, scopedRead } from "../../shared/db.js";
import { clearanceSql, type Clearance } from "../documents/repo.js";
import { documents } from "../documents/schema.js";
import { searchIndex, type SearchIndexRow, type SearchIndexView } from "./schema.js";

/** Singleton search engine instance — provider chosen via SEARCH_ENGINE env var. */
let engine: SearchEngine | null = null;

function getEngine(): SearchEngine {
  if (!engine) {
    engine = createSearchEngine();
  }
  return engine;
}

/** Allow injection for testing */
export function setEngine(e: SearchEngine | null): void {
  engine = e;
}

/** Initialize the search engine (call once at startup). */
export async function initializeSearch(): Promise<void> {
  await getEngine().initialize({ indexName: "knowledge_documents" });
}

/** Gracefully close the search engine connection. */
export async function closeSearch(): Promise<void> {
  if (engine) {
    await engine.close();
    engine = null;
  }
}

export type SearchResult = {
  id: string;
  documentId: string;
  title: string;
  content: string;
  tags: string[];
  score?: number | undefined;
};

export function toView(r: SearchIndexRow): SearchIndexView {
  return {
    id: r.id,
    tenantId: r.tenantId,
    documentId: r.documentId,
    title: r.title,
    content: r.content,
    tags: r.tags ?? [],
    status: r.status,
    indexedAt: r.indexedAt,
  };
}

export async function search(
  tenantId: string,
  query: string,
  category: string | undefined,
  tags: string[] | undefined,
  limit: number,
  offset: number,
  levels?: Clearance,
): Promise<SearchResult[]> {
  try {
    const response = await getEngine().search({
      q: query,
      tenantId,
      category,
      tags,
      limit,
      offset,
      // Clearance is part of the engine query itself, not a filter over its hits.
      ...(levels ? { accessLevels: [...levels] } : {}),
    });

    return response.hits.map((h: EngineResult) => ({
      id: h.id,
      documentId: h.documentId,
      title: h.title,
      content: h.content,
      tags: h.tags ?? [],
      score: h.score,
    }));
  } catch {
    // Fallback to the local index when the search engine is unavailable. A
    // limited caller always goes through the clearance-joined query.
    if (levels) return clearedSearch(tenantId, query, category, tags, limit, offset, levels);
    return fallbackDbSearch(tenantId, query, limit, offset);
  }
}

async function fallbackDbSearch(tenantId: string, query: string, limit: number, offset: number): Promise<SearchResult[]> {
  const rows = await scopedRead((tx) =>
    tx.select().from(searchIndex)
      .where(eq(searchIndex.tenantId, tenantId))
      .limit(limit)
      .offset(offset)
  );
  const q = query.toLowerCase();
  return rows
    .filter((r) => r.title.toLowerCase().includes(q) || r.content.toLowerCase().includes(q))
    .map((r) => ({
      id: r.id,
      documentId: r.documentId,
      title: r.title,
      content: r.content,
      tags: r.tags ?? [],
    }));
}

/**
 * Clearance-aware search over the local index. The access-level filter is part
 * of the retrieval query itself (join to knowledge.documents), so a document
 * above the caller's clearance is never fetched, ranked, summarised or cited.
 * Index rows whose document is unknown are not returned to a limited caller
 * (their level cannot be established).
 */
export async function clearedSearch(
  tenantId: string,
  query: string,
  category: string | undefined,
  tags: string[] | undefined,
  limit: number,
  offset: number,
  levels: Clearance,
): Promise<SearchResult[]> {
  const rows = await scopedRead(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.tenant_id', ${tenantId}, true)`);
    return tx.execute(sql`
      SELECT s.id, s.document_id AS "documentId", s.title, s.content, s.tags
      FROM knowledge.search_index s
      JOIN knowledge.documents d ON d.id = s.document_id AND d.tenant_id = s.tenant_id
      WHERE s.tenant_id = ${tenantId}
        AND (strpos(lower(s.title), lower(${query})) > 0 OR strpos(lower(s.content), lower(${query})) > 0)
        ${category ? sql`AND d.category = ${category}` : sql``}
        ${tags && tags.length ? sql`AND s.tags && ${tags}::text[]` : sql``}
        ${clearanceSql(levels)}
      ORDER BY s.indexed_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `);
  });
  const data = (rows as unknown as { rows?: Array<Record<string, unknown>> }).rows ?? (rows as unknown as Array<Record<string, unknown>>);
  return data.map((r) => ({
    id: String(r.id),
    documentId: String(r.documentId),
    title: String(r.title),
    content: String(r.content),
    tags: (r.tags as string[] | null) ?? [],
  }));
}

export async function indexDocument(tenantId: string, doc: { id: string; documentId: string; title: string; content: string; tags: string[] }): Promise<void> {
  // The engine index carries the document's access level so queries can be clearance-filtered.
  // An unknown document is indexed as restricted (fail closed).
  let accessLevel = "restricted";
  // Upsert into local search_index table (source of truth) within a transaction for RLS
  await db.transaction(async (tx) => {
    const lvl = await tx.select({ accessLevel: documents.accessLevel }).from(documents)
      .where(and(eq(documents.tenantId, tenantId), eq(documents.id, doc.documentId))).limit(1);
    if (lvl[0]) accessLevel = lvl[0].accessLevel;
    await tx.insert(searchIndex).values({
      id: doc.id,
      tenantId,
      documentId: doc.documentId,
      title: doc.title,
      content: doc.content,
      tags: doc.tags,
      indexedAt: new Date(),
    }).onConflictDoUpdate({
      target: searchIndex.id,
      set: { title: doc.title, content: doc.content, tags: doc.tags, indexedAt: new Date() },
    });
  });

  // Push to search engine
  try {
    await getEngine().index({
      id: doc.id,
      tenantId,
      documentId: doc.documentId,
      title: doc.title,
      content: doc.content,
      tags: doc.tags,
      accessLevel,
    });
  } catch {
    // Search engine down — local index is source of truth; relay job will catch up
  }
}

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export async function listAllForTenant(tenantId: string): Promise<SearchIndexView[]> {
  const rows = await scopedRead((tx) =>
    tx.select().from(searchIndex)
      .where(eq(searchIndex.tenantId, tenantId))
  );
  return rows.map(toView);
}

export async function removeDocument(tenantId: string, documentId: string): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.delete(searchIndex)
      .where(and(eq(searchIndex.tenantId, tenantId), eq(searchIndex.documentId, documentId)));
  });

  // Remove from search engine
  try {
    await getEngine().remove(tenantId, documentId);
  } catch {
    // Search engine down — relay job will handle cleanup
  }
}
