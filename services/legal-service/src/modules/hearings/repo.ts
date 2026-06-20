import { eq } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { legalHearings, legalOrders, type HearingRow } from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export async function findHearingByIdTx(tx: Writer, id: string): Promise<HearingRow | null> {
  const rows = await (tx as typeof db).select().from(legalHearings).where(eq(legalHearings.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function insertHearing(tx: Writer, row: typeof legalHearings.$inferInsert): Promise<void> {
  await tx.insert(legalHearings).values(row);
}

export async function updateHearing(tx: Writer, id: string, patch: Partial<typeof legalHearings.$inferInsert>): Promise<void> {
  await tx.update(legalHearings).set({ ...patch, updatedAt: new Date() }).where(eq(legalHearings.id, id));
}

export async function insertOrder(tx: Writer, row: typeof legalOrders.$inferInsert): Promise<void> {
  await tx.insert(legalOrders).values(row);
}
