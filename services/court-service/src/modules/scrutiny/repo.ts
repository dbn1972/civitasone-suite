import { eq, and, desc } from "drizzle-orm";
import { db, scopedRead } from "../../shared/db.js";
import { caseScrutiny, caseDefect } from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export type CaseScrutinyRow    = typeof caseScrutiny.$inferSelect;
export type CaseScrutinyInsert = typeof caseScrutiny.$inferInsert;
export type CaseDefectRow      = typeof caseDefect.$inferSelect;
export type CaseDefectInsert   = typeof caseDefect.$inferInsert;

export async function insertScrutiny(tx: Writer, row: CaseScrutinyInsert): Promise<void> {
  // Idempotent on the deterministic id: a redelivery with the same id is a no-op.
  await tx.insert(caseScrutiny).values(row).onConflictDoNothing({ target: caseScrutiny.id });
}

export async function getScrutiny(
  tenantId: string, id: string,
): Promise<CaseScrutinyRow | undefined> {
  const rows = await scopedRead<CaseScrutinyRow[]>((tx) => tx.select().from(caseScrutiny)
    .where(and(eq(caseScrutiny.tenantId, tenantId), eq(caseScrutiny.id, id)))
    .limit(1));
  return rows[0];
}

export async function getScrutinyForUpdate(
  tx: Writer, tenantId: string, id: string,
): Promise<{ status: string; version: number } | undefined> {
  const rows = await tx.select({ status: caseScrutiny.status, version: caseScrutiny.version })
    .from(caseScrutiny)
    .where(and(eq(caseScrutiny.tenantId, tenantId), eq(caseScrutiny.id, id)))
    .limit(1);
  return rows[0];
}

export async function insertDefect(tx: Writer, row: CaseDefectInsert): Promise<void> {
  // Idempotent on the deterministic id: a redelivery with the same id is a no-op.
  await tx.insert(caseDefect).values(row).onConflictDoNothing({ target: caseDefect.id });
}

export async function getDefectForUpdate(
  tx: Writer, tenantId: string, id: string,
): Promise<{ status: string; version: number } | undefined> {
  const rows = await tx.select({ status: caseDefect.status, version: caseDefect.version })
    .from(caseDefect)
    .where(and(eq(caseDefect.tenantId, tenantId), eq(caseDefect.id, id)))
    .limit(1);
  return rows[0];
}

export async function listDefectsByCase(tenantId: string, caseId: string): Promise<CaseDefectRow[]> {
  return scopedRead((tx) => tx.select().from(caseDefect)
    .where(and(eq(caseDefect.tenantId, tenantId), eq(caseDefect.caseId, caseId)))
    .orderBy(desc(caseDefect.createdAt)));
}
