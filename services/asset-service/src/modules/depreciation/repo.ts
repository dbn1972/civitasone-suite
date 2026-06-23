import { eq, and, isNull, SQL } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { assetDepSchedules, assetDepEntries, type DepScheduleInsert, type DepEntryInsert, type DepScheduleRow, type DepEntryRow } from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export async function findScheduleByAsset(assetId: string, tenantId: string): Promise<DepScheduleRow | null> {
  const rows = await db.select().from(assetDepSchedules)
    .where(and(eq(assetDepSchedules.assetId, assetId), eq(assetDepSchedules.tenantId, tenantId)))
    .limit(1);
  return rows[0] ?? null;
}

export async function findEntriesByAsset(assetId: string, tenantId: string): Promise<DepEntryRow[]> {
  return db.select().from(assetDepEntries)
    .where(and(eq(assetDepEntries.assetId, assetId), eq(assetDepEntries.tenantId, tenantId)));
}

export async function findDueEntries(period: string, depBook?: string): Promise<DepEntryRow[]> {
  const conditions: SQL[] = [eq(assetDepEntries.period, period), isNull(assetDepEntries.postedAt)];
  if (depBook) conditions.push(eq(assetDepEntries.depBook, depBook));
  return db.select().from(assetDepEntries).where(and(...conditions));
}

export async function insertSchedule(tx: Writer, row: DepScheduleInsert): Promise<void> {
  await tx.insert(assetDepSchedules).values(row);
}

export async function upsertEntry(tx: Writer, row: DepEntryInsert): Promise<void> {
  await tx.insert(assetDepEntries).values(row);
}

export async function markEntryPosted(tx: Writer, id: string, glRef: string, actorId: string): Promise<void> {
  await (tx as typeof db).update(assetDepEntries)
    .set({ postedAt: new Date(), glRef, updatedAt: new Date(), updatedBy: actorId })
    .where(eq(assetDepEntries.id, id));
}
