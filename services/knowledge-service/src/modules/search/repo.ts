import { eq, and } from "drizzle-orm";
import { createSearchEngine, type SearchEngine, type SearchResult as EngineResult } from "@civitasone/search";
import { db } from "../../shared/db.js";
import { searchIndex, type SearchIndexRow, type SearchIndexView } from "./schema.js";

/** Singleton search engine instance — provider chosen via SEARCH_ENGINE env var. */
let engine: SearchEngine | null = null;

function getEngine(): SearchEngine {
  if (!engine) {
    engine = createSearchEngine();
  }
  return engine;
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
): Promise<SearchResult[]> {
  try {
    const response = await getEngine().search({
      q: query,
      tenantId,
      category,
      tags,
      limit,
      offset,
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
    // Fallback to DB full-text (basic ILIKE) when search engine is unavailable
    return fallbackDbSearch(tenantId, query, limit, offset);
  }
}

async function fallbackDbSearch(tenantId: string, query: string, limit: number, offset: number): Promise<SearchResult[]> {
  const rows = await db.select().from(searchIndex)
    .where(eq(searchIndex.tenantId, tenantId))
    .limit(limit)
    .offset(offset);
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

export async function indexDocument(tenantId: string, doc: { id: string; documentId: string; title: string; content: string; tags: string[] }): Promise<void> {
  // Upsert into local search_index table (source of truth)
  await db.insert(searchIndex).values({
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

  // Push to search engine
  try {
    await getEngine().index({
      id: doc.id,
      tenantId,
      documentId: doc.documentId,
      title: doc.title,
      content: doc.content,
      tags: doc.tags,
    });
  } catch {
    // Search engine down — local index is source of truth; relay job will catch up
  }
}

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export async function listAllForTenant(tenantId: string): Promise<SearchIndexView[]> {
  const rows = await db.select().from(searchIndex)
    .where(eq(searchIndex.tenantId, tenantId));
  return rows.map(toView);
}

export async function removeDocument(tenantId: string, documentId: string): Promise<void> {
  await db.delete(searchIndex)
    .where(and(eq(searchIndex.tenantId, tenantId), eq(searchIndex.documentId, documentId)));

  // Remove from search engine
  try {
    await getEngine().remove(tenantId, documentId);
  } catch {
    // Search engine down — relay job will handle cleanup
  }
}
