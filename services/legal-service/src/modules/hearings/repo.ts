import { eq } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { legalHearings, legalOrders, legalOpinions, type HearingRow } from "./schema.js";

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

export async function listHearingsByTenant(tenantId: string, limit: number): Promise<HearingRow[]> {
  return db.transaction(async (tx) =>
    tx.select().from(legalHearings).where(eq(legalHearings.tenantId, tenantId)).limit(limit));
}

export async function listOrdersByTenant(tenantId: string, limit: number) {
  return db.transaction(async (tx) =>
    tx.select().from(legalOrders).where(eq(legalOrders.tenantId, tenantId)).limit(limit));
}

export async function listOpinionsByTenant(tenantId: string, limit: number) {
  return db.transaction(async (tx) =>
    tx.select().from(legalOpinions).where(eq(legalOpinions.tenantId, tenantId)).limit(limit));
}
