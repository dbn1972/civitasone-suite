import { eq, and, desc } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { filings } from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;
export type FilingRow    = typeof filings.$inferSelect;
export type FilingInsert = typeof filings.$inferInsert;

export async function insertFiling(tx: Writer, row: FilingInsert): Promise<void> {
  // Idempotent on the deterministic id: a redelivery with the same id is a no-op.
  await tx.insert(filings).values(row).onConflictDoNothing({ target: filings.id });
}

export async function listFilingsByCase(tenantId: string, caseId: string): Promise<FilingRow[]> {
  return db.select().from(filings)
    .where(and(eq(filings.tenantId, tenantId), eq(filings.caseId, caseId)))
    .orderBy(desc(filings.createdAt));
}
