/**
 * visits/repo.ts — Database operations for visit logs.
 */
import { eq, and, sql, desc, type SQL } from "drizzle-orm";
import { db, scopedRead, type ScopedTx } from "../../shared/db.js";
import { visits, type VisitRow, type VisitInsert } from "./schema.js";

export function toView(r: VisitRow) {
  return {
    id: r.id,
    tenantId: r.tenantId,
    taskId: r.taskId,
    agentId: r.agentId,
    checkInLatitude: r.checkInLatitude,
    checkInLongitude: r.checkInLongitude,
    checkOutLatitude: r.checkOutLatitude,
    checkOutLongitude: r.checkOutLongitude,
    checkInAt: r.checkInAt?.toISOString() ?? null,
    checkOutAt: r.checkOutAt?.toISOString() ?? null,
    durationMinutes: r.durationMinutes,
    outcome: r.outcome,
    notes: r.notes,
    photos: r.photos,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    version: r.version,
  };
}

export type VisitView = ReturnType<typeof toView>;

export async function findById(id: string, tenantId: string): Promise<VisitRow | null> {
  const rows = await scopedRead((tx) =>
    tx.select().from(visits).where(and(eq(visits.id, id), eq(visits.tenantId, tenantId))).limit(1),
  );
  return rows[0] ?? null;
}

export async function findByTaskId(
  taskId: string,
  tenantId: string,
  limit: number,
  offset: number,
): Promise<{ rows: VisitRow[]; total: number }> {
  const where = and(eq(visits.taskId, taskId), eq(visits.tenantId, tenantId));

  const rows = await scopedRead((tx) =>
    tx.select().from(visits).where(where).orderBy(desc(visits.checkInAt)).limit(limit).offset(offset),
  );

  const countResult = await scopedRead((tx) =>
    tx.select({ count: sql<number>`count(*)::int` }).from(visits).where(where),
  );
  const total = countResult[0]?.count ?? 0;

  return { rows, total };
}

export async function findByAgent(
  agentId: string,
  tenantId: string,
  limit: number,
  offset: number,
): Promise<{ rows: VisitRow[]; total: number }> {
  const where = and(eq(visits.agentId, agentId), eq(visits.tenantId, tenantId));

  const rows = await scopedRead((tx) =>
    tx.select().from(visits).where(where).orderBy(desc(visits.checkInAt)).limit(limit).offset(offset),
  );

  const countResult = await scopedRead((tx) =>
    tx.select({ count: sql<number>`count(*)::int` }).from(visits).where(where),
  );
  const total = countResult[0]?.count ?? 0;

  return { rows, total };
}

export async function insert(tx: ScopedTx, row: VisitInsert): Promise<void> {
  await tx.insert(visits).values(row);
}

export async function update(
  tx: ScopedTx,
  id: string,
  tenantId: string,
  patch: Partial<VisitInsert>,
  currentVersion: number,
): Promise<boolean> {
  const result = await tx
    .update(visits)
    .set({ ...patch, updatedAt: new Date(), version: sql`${visits.version} + 1` })
    .where(and(eq(visits.id, id), eq(visits.tenantId, tenantId), eq(visits.version, currentVersion)))
    .returning({ id: visits.id });
  return result.length > 0;
}
