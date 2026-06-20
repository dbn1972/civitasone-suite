import { eq, desc } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { documents, type DocumentRow, type DocumentInsert, type DocumentView } from "./schema.js";

export function toView(r: DocumentRow): DocumentView {
  return {
    id: r.id,
    tenantId: r.tenantId,
    title: r.title,
    category: r.category,
    status: r.status,
    version: r.version,
  };
}

export async function listByTenant(tenantId: string, limit: number, offset: number): Promise<DocumentView[]> {
  const rows = await db.select().from(documents)
    .where(eq(documents.tenantId, tenantId))
    .orderBy(desc(documents.updatedAt))
    .limit(limit)
    .offset(offset);
  return rows.map(toView);
}

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export async function insert(tx: Writer, row: DocumentInsert): Promise<void> {
  await tx.insert(documents).values(row);
}
