import { eq, and, desc } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { searchIndex, type SearchIndexRow, type SearchIndexInsert, type SearchIndexView } from "./schema.js";

/** Meilisearch client wrapper — falls back to DB search when Meilisearch unavailable */
const MEILI_HOST = process.env.MEILISEARCH_HOST ?? "http://localhost:7700";
const MEILI_KEY = process.env.MEILISEARCH_API_KEY ?? "";

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

/**
 * Escape a value for use inside a Meilisearch filter string literal.
 * Enforces strict alphanumeric + limited punctuation charset, and escapes
 * double quotes to prevent filter injection (e.g. `x" OR tenantId="other`).
 */
function escapeMeiliFilter(value: string): string {
  // Strip any characters that could be filter syntax
  // Allow: alphanumeric, hyphen, underscore, dot, space, colon, slash
  const sanitized = value.replace(/[^a-zA-Z0-9\-_.: /]/g, "");
  // Escape remaining double quotes (should be none after above, but belt-and-suspenders)
  return sanitized.replace(/"/g, '\\"');
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
    const filter: string[] = [`tenantId = "${escapeMeiliFilter(tenantId)}"`];
    if (category) filter.push(`category = "${escapeMeiliFilter(category)}"`);
    if (tags?.length) filter.push(tags.map((t) => `tags = "${escapeMeiliFilter(t)}"`).join(" AND "));

    const res = await fetch(`${MEILI_HOST}/indexes/knowledge_documents/search`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(MEILI_KEY ? { Authorization: `Bearer ${MEILI_KEY}` } : {}),
      },
      body: JSON.stringify({ q: query, filter, limit, offset }),
    });

    if (!res.ok) throw new Error(`Meilisearch returned ${res.status}`);
    const data = (await res.json()) as { hits: Array<{ id: string; documentId: string; title: string; content: string; tags: string[]; _rankingScore?: number }> };
    return data.hits.map((h) => ({
      id: h.id,
      documentId: h.documentId,
      title: h.title,
      content: h.content,
      tags: h.tags ?? [],
      score: h._rankingScore,
    }));
  } catch {
    // Fallback to DB full-text (basic ILIKE) when Meilisearch unavailable
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
  // Upsert into local search_index table
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

  // Push to Meilisearch
  try {
    await fetch(`${MEILI_HOST}/indexes/knowledge_documents/documents`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(MEILI_KEY ? { Authorization: `Bearer ${MEILI_KEY}` } : {}),
      },
      body: JSON.stringify([{ ...doc, tenantId }]),
    });
  } catch {
    // Meilisearch down — local index is source of truth; relay job will catch up
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

  // Remove from Meilisearch
  try {
    await fetch(`${MEILI_HOST}/indexes/knowledge_documents/documents/${documentId}`, {
      method: "DELETE",
      headers: MEILI_KEY ? { Authorization: `Bearer ${MEILI_KEY}` } : {},
    });
  } catch {
    // Meilisearch down — relay job will handle cleanup
  }
}
