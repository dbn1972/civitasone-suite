import { eq, and, sql, desc } from "drizzle-orm";
import { db, scopedRead, type ScopedTx } from "../../shared/db.js";
import { parksTreeRequests, type TreeRequestRow, type TreeRequestInsert } from "./schema.js";

export function toView(r: TreeRequestRow) {
  return {
    id: r.id, tenantId: r.tenantId, requestNumber: r.requestNumber, requestedBy: r.requestedBy,
    requestType: r.requestType, location: r.location, treeSpecies: r.treeSpecies,
    reason: r.reason, photos: r.photos, status: r.status,
    inspectorId: r.inspectorId, inspectionReport: r.inspectionReport, approvedBy: r.approvedBy,
    createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString(), version: r.version,
  };
}

export async function findById(id: string, tenantId: string): Promise<TreeRequestRow | null> {
  const rows = await scopedRead((tx) =>
    tx.select().from(parksTreeRequests).where(and(eq(parksTreeRequests.id, id), eq(parksTreeRequests.tenantId, tenantId))).limit(1),
  );
  return rows[0] ?? null;
}

// Same lookup as findById, but against an already-open transaction (tx)
// instead of opening its own via scopedRead. See complaints/repo.ts's
// findByIdTx for the full rationale (identical need, identical fix).
export async function findByIdTx(tx: ScopedTx, id: string, tenantId: string): Promise<TreeRequestRow | null> {
  const rows = await tx.select().from(parksTreeRequests).where(and(eq(parksTreeRequests.id, id), eq(parksTreeRequests.tenantId, tenantId))).limit(1);
  return rows[0] ?? null;
}

export async function listByTenant(tenantId: string, limit: number, offset: number, status?: string) {
  const conditions = [eq(parksTreeRequests.tenantId, tenantId)];
  if (status) conditions.push(eq(parksTreeRequests.status, status));
  const where = and(...conditions);
  const rows = await scopedRead((tx) =>
    tx.select().from(parksTreeRequests).where(where).orderBy(desc(parksTreeRequests.createdAt)).limit(limit).offset(offset),
  );
  const countResult = await scopedRead((tx) =>
    tx.select({ count: sql<number>`count(*)::int` }).from(parksTreeRequests).where(where),
  );
  return { rows, total: countResult[0]?.count ?? 0 };
}

export async function insert(tx: ScopedTx, row: TreeRequestInsert): Promise<void> {
  await tx.insert(parksTreeRequests).values(row);
}

export async function update(tx: ScopedTx, id: string, tenantId: string, patch: Partial<TreeRequestInsert>, currentVersion: number): Promise<boolean> {
  const result = await tx
    .update(parksTreeRequests)
    .set({ ...patch, updatedAt: new Date(), version: sql`${parksTreeRequests.version} + 1` })
    .where(and(eq(parksTreeRequests.id, id), eq(parksTreeRequests.tenantId, tenantId), eq(parksTreeRequests.version, currentVersion)))
    .returning({ id: parksTreeRequests.id });
  return result.length > 0;
}

// Reserves the next request number from the DB sequence — see
// complaints/repo.ts's nextComplaintNumber for the full rationale
// (identical bug, identical fix).
export async function nextRequestNumber(tx: ScopedTx): Promise<number> {
  const [row] = (await tx.execute(
    sql`SELECT nextval('"civitas_parks"."request_number_seq"')::bigint AS seq`,
  )) as unknown as Array<{ seq: number }>;
  return Number(row!.seq);
}
