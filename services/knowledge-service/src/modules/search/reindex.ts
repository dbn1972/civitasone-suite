import { sql } from "drizzle-orm";
import type { SearchEngine, SearchDocument } from "@civitasone/search";
import { scopedRead } from "../../shared/db.js";

/**
 * Re-index every search_index row of one tenant into the search engine WITH the
 * current access level of its document, so clearance filtering (the accessLevel
 * facet) works for documents indexed before the facet existed.
 *
 * - accessLevel comes from knowledge.documents; an index row whose document is
 *   unknown is indexed as "restricted" (fail closed).
 * - Keyset-paginated by index id; safe to re-run (the engine upserts by id).
 * Returns the number of documents sent to the engine.
 */
export async function reindexTenant(
  engine: Pick<SearchEngine, "bulkIndex">,
  tenantId: string,
  batchSize = 500,
): Promise<number> {
  let lastId = "00000000-0000-0000-0000-000000000000";
  let total = 0;
  for (;;) {
    const rows = await scopedRead(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.tenant_id', ${tenantId}, true)`);
      return tx.execute(sql`
        SELECT s.id, s.document_id AS "documentId", s.title, s.content, s.tags,
               d.access_level AS "accessLevel", d.category
        FROM knowledge.search_index s
        LEFT JOIN knowledge.documents d ON d.id = s.document_id AND d.tenant_id = s.tenant_id
        WHERE s.tenant_id = ${tenantId} AND s.id > ${lastId}::uuid
        ORDER BY s.id
        LIMIT ${batchSize}
      `);
    });
    const data = (rows as unknown as { rows?: Array<Record<string, unknown>> }).rows ?? (rows as unknown as Array<Record<string, unknown>>);
    if (data.length === 0) break;
    const docs: SearchDocument[] = data.map((r) => ({
      id: String(r.id),
      tenantId,
      documentId: String(r.documentId),
      title: String(r.title),
      content: String(r.content),
      tags: (r.tags as string[] | null) ?? [],
      category: r.category == null ? undefined : String(r.category),
      accessLevel: r.accessLevel == null ? "restricted" : String(r.accessLevel),
    }));
    await engine.bulkIndex(docs);
    total += docs.length;
    lastId = docs[docs.length - 1]!.id;
    if (data.length < batchSize) break;
  }
  return total;
}
