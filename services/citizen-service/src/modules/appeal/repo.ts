import { eq, and, desc } from "drizzle-orm";
import { db } from "../../shared/db.js";
import {
  appeals, appealHearings,
  type AppealRow, type AppealInsert, type HearingRow, type HearingInsert,
} from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export async function insertAppeal(tx: Writer, row: AppealInsert): Promise<void> {
  await tx.insert(appeals).values(row);
}

export async function findAppealByIdTx(tx: Writer, id: string, tenantId: string): Promise<AppealRow | null> {
  const rows = await (tx as typeof db).select().from(appeals)
    .where(and(eq(appeals.id, id), eq(appeals.tenantId, tenantId))).limit(1);
  return rows[0] ?? null;
}

export async function findAppealById(id: string, tenantId: string): Promise<AppealRow | null> {
  return db.transaction((tx) => findAppealByIdTx(tx, id, tenantId));
}

export async function updateAppeal(tx: Writer, id: string, tenantId: string, patch: Partial<AppealInsert>): Promise<void> {
  await tx.update(appeals).set({ ...patch, updatedAt: new Date() })
    .where(and(eq(appeals.id, id), eq(appeals.tenantId, tenantId)));
}

export async function listAppeals(tenantId: string, limit = 200): Promise<AppealRow[]> {
  return db.transaction((tx) => tx.select().from(appeals)
    .where(eq(appeals.tenantId, tenantId))
    .orderBy(desc(appeals.createdAt)).limit(limit));
}

export async function insertHearing(tx: Writer, row: HearingInsert): Promise<void> {
  await tx.insert(appealHearings).values(row);
}

export async function listHearingsTx(tx: Writer, tenantId: string, appealId: string): Promise<HearingRow[]> {
  return (tx as typeof db).select().from(appealHearings)
    .where(and(eq(appealHearings.tenantId, tenantId), eq(appealHearings.appealId, appealId)))
    .orderBy(desc(appealHearings.createdAt));
}

export async function listHearings(tenantId: string, appealId: string): Promise<HearingRow[]> {
  return db.transaction((tx) => listHearingsTx(tx, tenantId, appealId));
}

export async function updateHearing(tx: Writer, id: string, tenantId: string, patch: Partial<HearingInsert>): Promise<void> {
  await tx.update(appealHearings).set({ ...patch, updatedAt: new Date() })
    .where(and(eq(appealHearings.id, id), eq(appealHearings.tenantId, tenantId)));
}
