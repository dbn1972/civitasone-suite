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
