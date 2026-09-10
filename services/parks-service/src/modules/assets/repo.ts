import { eq, and, sql, desc } from "drizzle-orm";
import { db, scopedRead, type ScopedTx } from "../../shared/db.js";
import { parksAssets, type AssetRow, type AssetInsert } from "./schema.js";

export function toView(r: AssetRow) {
  return {
    id: r.id, tenantId: r.tenantId, assetCode: r.assetCode, assetType: r.assetType,
    name: r.name, location: r.location, area: r.area, areaUnit: r.areaUnit,
    status: r.status, lastMaintenanceDate: r.lastMaintenanceDate,
    maintenanceHistory: r.maintenanceHistory,
    createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString(), version: r.version,
  };
}

export async function findById(id: string, tenantId: string): Promise<AssetRow | null> {
  const rows = await scopedRead((tx) =>
    tx.select().from(parksAssets).where(and(eq(parksAssets.id, id), eq(parksAssets.tenantId, tenantId))).limit(1),
  );
  return rows[0] ?? null;
}

// TX-001 -- same lookup as findById, but against an already-open transaction
// (tx) instead of opening its own via scopedRead(). For callers that already
// hold a transaction -- e.g. assets/consumer.ts's RECORD_MAINTENANCE handler,
// which reads the existing asset from inside its own db.transaction() before
// appending to maintenanceHistory -- and must not nest a second, independent
// db.transaction() inside the first: under pool.max concurrent in-flight
// consumer transactions, the nested call has no free connection to open on
// and deadlocks the pool silently. Mirrors complaints/repo.ts's and
// tree_requests/repo.ts's findByIdTx, the established pattern in this
// service for this exact need.
export async function findByIdTx(tx: ScopedTx, id: string, tenantId: string): Promise<AssetRow | null> {
  const rows = await tx.select().from(parksAssets).where(and(eq(parksAssets.id, id), eq(parksAssets.tenantId, tenantId))).limit(1);
  return rows[0] ?? null;
}

export async function findByCode(code: string, tenantId: string): Promise<AssetRow | null> {
  const rows = await scopedRead((tx) =>
    tx.select().from(parksAssets).where(and(eq(parksAssets.assetCode, code), eq(parksAssets.tenantId, tenantId))).limit(1),
  );
  return rows[0] ?? null;
}

export async function listByTenant(tenantId: string, limit: number, offset: number, filters: { status?: string; assetType?: string } = {}) {
  const conditions = [eq(parksAssets.tenantId, tenantId)];
  if (filters.status) conditions.push(eq(parksAssets.status, filters.status));
  if (filters.assetType) conditions.push(eq(parksAssets.assetType, filters.assetType));
  const where = and(...conditions);
  const rows = await scopedRead((tx) =>
    tx.select().from(parksAssets).where(where).orderBy(desc(parksAssets.createdAt)).limit(limit).offset(offset),
  );
  const countResult = await scopedRead((tx) =>
    tx.select({ count: sql<number>`count(*)::int` }).from(parksAssets).where(where),
  );
  return { rows, total: countResult[0]?.count ?? 0 };
}

export async function insert(tx: ScopedTx, row: AssetInsert): Promise<void> {
  await tx.insert(parksAssets).values(row);
}

export async function update(tx: ScopedTx, id: string, tenantId: string, patch: Partial<AssetInsert>, currentVersion: number): Promise<boolean> {
  const result = await tx
    .update(parksAssets)
    .set({ ...patch, updatedAt: new Date(), version: sql`${parksAssets.version} + 1` })
    .where(and(eq(parksAssets.id, id), eq(parksAssets.tenantId, tenantId), eq(parksAssets.version, currentVersion)))
    .returning({ id: parksAssets.id });
  return result.length > 0;
}

// Reserves the next asset code from the DB sequence — see
// complaints/repo.ts's nextComplaintNumber for the full rationale
// (identical bug, identical fix).
export async function nextAssetCode(tx: ScopedTx): Promise<number> {
  const [row] = (await tx.execute(
    sql`SELECT nextval('"civitas_parks"."asset_code_seq"')::bigint AS seq`,
  )) as unknown as Array<{ seq: number }>;
  return Number(row!.seq);
}
