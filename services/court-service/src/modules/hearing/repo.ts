import { eq, and, desc } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { hearings } from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;
export type HearingRow    = typeof hearings.$inferSelect;
export type HearingInsert = typeof hearings.$inferInsert;

export async function insertHearing(tx: Writer, row: HearingInsert): Promise<void> {
  // Idempotent on the deterministic id: a redelivery with the same id is a no-op.
  await tx.insert(hearings).values(row).onConflictDoNothing({ target: hearings.id });
}

export async function getHearingForUpdate(
  tx: Writer, tenantId: string, id: string,
): Promise<{ status: string; version: number } | undefined> {
  const rows = await tx.select({ status: hearings.status, version: hearings.version })
    .from(hearings)
    .where(and(eq(hearings.tenantId, tenantId), eq(hearings.id, id)))
    .limit(1);
  return rows[0];
}

export async function listHearingsByCase(tenantId: string, caseId: string): Promise<HearingRow[]> {
  return db.select().from(hearings)
    .where(and(eq(hearings.tenantId, tenantId), eq(hearings.caseId, caseId)))
    .orderBy(desc(hearings.scheduledDate));
}
