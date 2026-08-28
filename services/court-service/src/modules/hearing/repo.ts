import { eq, and, desc } from "drizzle-orm";
import { db, scopedRead } from "../../shared/db.js";
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
  return scopedRead((tx) => tx.select().from(hearings)
    .where(and(eq(hearings.tenantId, tenantId), eq(hearings.caseId, caseId)))
    .orderBy(desc(hearings.scheduledDate)));
}

/** Single-row read for a synchronous pre-check before publishing an adjourn/
 *  outcome command (mirrors what the consumer reads inside its own tx, so the
 *  route can reject a foreseeable illegal transition immediately instead of
 *  the caller getting a 202 that silently dead-letters). Not cached -- this
 *  module does not use the read-through cache anywhere else either. */
export async function getHearingById(tenantId: string, id: string): Promise<HearingRow | undefined> {
  const rows = await scopedRead<HearingRow[]>((tx) => tx.select().from(hearings)
    .where(and(eq(hearings.tenantId, tenantId), eq(hearings.id, id)))
    .limit(1));
  return rows[0];
}
