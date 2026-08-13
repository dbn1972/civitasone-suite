import { eq, and, sql, desc } from "drizzle-orm";
import { db, scopedRead, type ScopedTx } from "../../shared/db.js";
import { drainageFieldActions, type FieldActionRow, type FieldActionInsert } from "./schema.js";

export function toView(r: FieldActionRow) {
  return {
    id: r.id, tenantId: r.tenantId, complaintId: r.complaintId,
    actionType: r.actionType, performedBy: r.performedBy,
    performedAt: r.performedAt.toISOString(), drainAssetRef: r.drainAssetRef,
    notes: r.notes, beforePhoto: r.beforePhoto, afterPhoto: r.afterPhoto,
    durationMinutes: r.durationMinutes,
    createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString(), version: r.version,
  };
}

export async function findById(id: string, tenantId: string): Promise<FieldActionRow | null> {
  const rows = await scopedRead((tx) =>
    tx.select().from(drainageFieldActions).where(and(eq(drainageFieldActions.id, id), eq(drainageFieldActions.tenantId, tenantId))).limit(1),
  );
  return rows[0] ?? null;
}

export async function listByComplaint(complaintId: string, tenantId: string) {
  const rows = await scopedRead((tx) =>
    tx.select().from(drainageFieldActions)
      .where(and(eq(drainageFieldActions.complaintId, complaintId), eq(drainageFieldActions.tenantId, tenantId)))
      .orderBy(desc(drainageFieldActions.performedAt)),
  );
  return rows;
}

export async function listByTenant(tenantId: string, limit: number, offset: number) {
  const where = eq(drainageFieldActions.tenantId, tenantId);
  const rows = await scopedRead((tx) =>
    tx.select().from(drainageFieldActions).where(where).orderBy(desc(drainageFieldActions.performedAt)).limit(limit).offset(offset),
  );
  const countResult = await scopedRead((tx) =>
    tx.select({ count: sql<number>`count(*)::int` }).from(drainageFieldActions).where(where),
  );
  return { rows, total: countResult[0]?.count ?? 0 };
}

export async function insert(tx: ScopedTx, row: FieldActionInsert): Promise<void> {
  await tx.insert(drainageFieldActions).values(row);
}
