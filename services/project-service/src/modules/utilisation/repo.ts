import { eq, and } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { projectUcStatements, projectUcItems, type UcStatementInsert, type UcItemInsert } from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export async function insertUcStatement(tx: Writer, row: UcStatementInsert): Promise<void> {
  await tx.insert(projectUcStatements).values(row);
}

export async function insertUcItems(tx: Writer, rows: UcItemInsert[]): Promise<void> {
  if (rows.length) await tx.insert(projectUcItems).values(rows);
}

export async function listUcStatementsByScheme(schemeId: string, tenantId: string, limit = 500): Promise<(typeof projectUcStatements.$inferSelect)[]> {
  // Wrapped in db.transaction() so wrapWithTenantGuc injects app.tenant_id
  // before this read — a bare db.select() runs with no RLS GUC set.
  return db.transaction((tx) => tx.select().from(projectUcStatements)
    .where(and(eq(projectUcStatements.schemeId, schemeId), eq(projectUcStatements.tenantId, tenantId)))
    .limit(limit));
}
