import { eq, and, desc } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { appeals } from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;
export type AppealRow    = typeof appeals.$inferSelect;
export type AppealInsert = typeof appeals.$inferInsert;

export async function insertAppeal(tx: Writer, row: AppealInsert): Promise<void> {
  // Idempotent on the deterministic id: a redelivery with the same id is a no-op.
  await tx.insert(appeals).values(row).onConflictDoNothing({ target: appeals.id });
}

/** Read the current (status, version) of an appeal inside the caller's tx, so the
 *  transition check and the version-guarded write see a consistent snapshot. */
export async function getAppealForUpdate(
  tx: Writer, tenantId: string, id: string,
): Promise<{ status: string; version: number } | undefined> {
  const rows = await tx.select({ status: appeals.status, version: appeals.version })
    .from(appeals)
    .where(and(eq(appeals.tenantId, tenantId), eq(appeals.id, id)))
    .limit(1);
  return rows[0];
}

export async function listAppealsByCase(tenantId: string, originalCaseId: string): Promise<AppealRow[]> {
  return db.select().from(appeals)
    .where(and(eq(appeals.tenantId, tenantId), eq(appeals.originalCaseId, originalCaseId)))
    .orderBy(desc(appeals.filedDate));
}

export async function getAppeal(tenantId: string, id: string): Promise<AppealRow | undefined> {
  const rows = await db.select().from(appeals)
    .where(and(eq(appeals.tenantId, tenantId), eq(appeals.id, id)))
    .limit(1);
  return rows[0];
}
