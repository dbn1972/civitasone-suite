import { eq, and, SQL } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { assetCategories, assetAssets, type CategoryInsert, type AssetInsert, type AssetRow } from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

// P0-1: every by-id read/update MUST be tenant-scoped. Filtering on id alone
// leaks/mutates another tenant's asset. All call sites pass the request tenant.
export async function findAssetById(id: string, tenantId: string): Promise<AssetRow | null> {
  const rows = await db.select().from(assetAssets)
    .where(and(eq(assetAssets.id, id), eq(assetAssets.tenantId, tenantId)))
    .limit(1);
  return rows[0] ?? null;
}

export async function findAssetsByTenant(tenantId: string, opts?: { category?: string; status?: string; type?: string; limit?: number; offset?: number }): Promise<AssetRow[]> {
  const conditions: SQL[] = [eq(assetAssets.tenantId, tenantId)];
  if (opts?.category) conditions.push(eq(assetAssets.categoryId, opts.category));
  if (opts?.status)   conditions.push(eq(assetAssets.status, opts.status));
  if (opts?.type)     conditions.push(eq(assetAssets.assetType, opts.type));
  return db.select().from(assetAssets)
    .where(and(...conditions))
    .limit(opts?.limit ?? 50)
    .offset(opts?.offset ?? 0);
}

export async function insertCategory(tx: Writer, row: CategoryInsert): Promise<void> {
  await tx.insert(assetCategories).values(row);
}

export async function insertAsset(tx: Writer, row: AssetInsert): Promise<void> {
  await tx.insert(assetAssets).values(row);
}

export async function updateAssetStatus(tx: Writer, id: string, tenantId: string, status: string, actorId: string): Promise<void> {
  await (tx as typeof db).update(assetAssets)
    .set({ status, updatedAt: new Date(), updatedBy: actorId })
    .where(and(eq(assetAssets.id, id), eq(assetAssets.tenantId, tenantId)));
}

export async function updateAssetBookValue(
  tx: Writer, id: string, tenantId: string,
  bookValue: bigint, accumulatedDep: bigint, actorId: string
): Promise<void> {
  await (tx as typeof db).update(assetAssets)
    .set({ bookValue, accumulatedDep, updatedAt: new Date(), updatedBy: actorId })
    .where(and(eq(assetAssets.id, id), eq(assetAssets.tenantId, tenantId)));
}

export async function updateAssetLocation(tx: Writer, id: string, tenantId: string, location: string, actorId: string): Promise<void> {
  await (tx as typeof db).update(assetAssets)
    .set({ location, status: "transferred", updatedAt: new Date(), updatedBy: actorId })
    .where(and(eq(assetAssets.id, id), eq(assetAssets.tenantId, tenantId)));
}

export async function updateAssetBarcode(tx: Writer, id: string, tenantId: string, barcode: string, actorId: string): Promise<void> {
  await (tx as typeof db).update(assetAssets)
    .set({ barcode, updatedAt: new Date(), updatedBy: actorId })
    .where(and(eq(assetAssets.id, id), eq(assetAssets.tenantId, tenantId)));
}
