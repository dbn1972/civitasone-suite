import { eq, and, sql, desc } from "drizzle-orm";
import { db, scopedRead, type ScopedTx } from "../../shared/db.js";
import { swmCollectionRequests, swmFieldTasks, type CollectionRequestRow, type CollectionRequestInsert, type FieldTaskRow, type FieldTaskInsert } from "./schema.js";

export function requestToView(r: CollectionRequestRow) {
  return {
    id: r.id, tenantId: r.tenantId, requestNumber: r.requestNumber, requestedBy: r.requestedBy,
    wasteType: r.wasteType, estimatedQuantity: r.estimatedQuantity, address: r.address,
    preferredDate: r.preferredDate, preferredSlot: r.preferredSlot,
    status: r.status, vehicleId: r.vehicleId, feeMinor: r.feeMinor, feePaid: r.feePaid,
    createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString(), version: r.version,
  };
}

export function taskToView(r: FieldTaskRow) {
  return {
    id: r.id, tenantId: r.tenantId, taskNumber: r.taskNumber, routeId: r.routeId,
    zoneId: r.zoneId, assignedTo: r.assignedTo, taskDate: r.taskDate,
    assetRefs: r.assetRefs, status: r.status,
    completedAt: r.completedAt?.toISOString() ?? null, notes: r.notes, photos: r.photos,
    createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString(), version: r.version,
  };
}

export async function findRequestById(id: string, tenantId: string): Promise<CollectionRequestRow | null> {
  const rows = await scopedRead((tx) =>
    tx.select().from(swmCollectionRequests).where(and(eq(swmCollectionRequests.id, id), eq(swmCollectionRequests.tenantId, tenantId))).limit(1),
  );
  return rows[0] ?? null;
}

export async function listRequests(tenantId: string, limit: number, offset: number, status?: string) {
  const conditions = [eq(swmCollectionRequests.tenantId, tenantId)];
  if (status) conditions.push(eq(swmCollectionRequests.status, status));
  const where = and(...conditions);
  const rows = await scopedRead((tx) =>
    tx.select().from(swmCollectionRequests).where(where).orderBy(desc(swmCollectionRequests.createdAt)).limit(limit).offset(offset),
  );
  const countResult = await scopedRead((tx) =>
    tx.select({ count: sql<number>`count(*)::int` }).from(swmCollectionRequests).where(where),
  );
  return { rows, total: countResult[0]?.count ?? 0 };
}

export async function insertRequest(tx: ScopedTx, row: CollectionRequestInsert): Promise<void> {
  await tx.insert(swmCollectionRequests).values(row);
}

export async function updateRequest(tx: ScopedTx, id: string, tenantId: string, patch: Partial<CollectionRequestInsert>, currentVersion: number): Promise<boolean> {
  const result = await tx
    .update(swmCollectionRequests)
    .set({ ...patch, updatedAt: new Date(), version: sql`${swmCollectionRequests.version} + 1` })
    .where(and(eq(swmCollectionRequests.id, id), eq(swmCollectionRequests.tenantId, tenantId), eq(swmCollectionRequests.version, currentVersion)))
    .returning({ id: swmCollectionRequests.id });
  return result.length > 0;
}

export async function findTaskById(id: string, tenantId: string): Promise<FieldTaskRow | null> {
  const rows = await scopedRead((tx) =>
    tx.select().from(swmFieldTasks).where(and(eq(swmFieldTasks.id, id), eq(swmFieldTasks.tenantId, tenantId))).limit(1),
  );
  return rows[0] ?? null;
}

export async function listTasks(tenantId: string, limit: number, offset: number, status?: string) {
  const conditions = [eq(swmFieldTasks.tenantId, tenantId)];
  if (status) conditions.push(eq(swmFieldTasks.status, status));
  const where = and(...conditions);
  const rows = await scopedRead((tx) =>
    tx.select().from(swmFieldTasks).where(where).orderBy(desc(swmFieldTasks.createdAt)).limit(limit).offset(offset),
  );
  const countResult = await scopedRead((tx) =>
    tx.select({ count: sql<number>`count(*)::int` }).from(swmFieldTasks).where(where),
  );
  return { rows, total: countResult[0]?.count ?? 0 };
}

export async function insertTask(tx: ScopedTx, row: FieldTaskInsert): Promise<void> {
  await tx.insert(swmFieldTasks).values(row);
}

export async function updateTask(tx: ScopedTx, id: string, tenantId: string, patch: Partial<FieldTaskInsert>, currentVersion: number): Promise<boolean> {
  const result = await tx
    .update(swmFieldTasks)
    .set({ ...patch, updatedAt: new Date(), version: sql`${swmFieldTasks.version} + 1` })
    .where(and(eq(swmFieldTasks.id, id), eq(swmFieldTasks.tenantId, tenantId), eq(swmFieldTasks.version, currentVersion)))
    .returning({ id: swmFieldTasks.id });
  return result.length > 0;
}
