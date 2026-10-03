import { eq, and, asc, SQL, sql } from "drizzle-orm";
import { db, scopedRead } from "../../shared/db.js";
import { assetCategories, assetAssets, type CategoryInsert, type CategoryRow, type AssetInsert, type AssetRow } from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

// P0-1: every by-id read/update MUST be tenant-scoped. Filtering on id alone
// leaks/mutates another tenant's asset. All call sites pass the request tenant.
export async function findAssetById(id: string, tenantId: string): Promise<AssetRow | null> {
  // scopedRead() so wrapWithTenantGuc injects app.tenant_id before this
  // read — a bare db.select() runs with no RLS GUC set.
  const rows = await scopedRead((tx) => tx.select().from(assetAssets)
    .where(and(eq(assetAssets.id, id), eq(assetAssets.tenantId, tenantId)))
    .limit(1));
  return rows[0] ?? null;
}

/**
 * Tx-scoped variant of findAssetById: reads through the callers already-open
 * transaction instead of opening a nested one via scopedRead. Calling the
 * scopedRead-based version from inside an open db.transaction() opens a
 * SECOND transaction competing for a connection from the same pool as the
 * outer one, deadlocking every in-flight command once concurrency reaches
 * pool.max (see .claude/skills/16-production-readiness-audit.md section 1).
 */
export async function findAssetByIdTx(tx: Writer, id: string, tenantId: string): Promise<AssetRow | null> {
  const rows = await tx.select().from(assetAssets)
    .where(and(eq(assetAssets.id, id), eq(assetAssets.tenantId, tenantId)))
    .limit(1);
  return rows[0] ?? null;
}

export async function findAssetByCode(tenantId: string, code: string): Promise<AssetRow | null> {
  const rows = await scopedRead((tx) => tx.select().from(assetAssets)
    .where(and(eq(assetAssets.tenantId, tenantId), eq(assetAssets.code, code)))
    .limit(1));
  return rows[0] ?? null;
}

type AssetFilter = { category?: string; status?: string; type?: string; search?: string };

function assetConditions(tenantId: string, opts?: AssetFilter): SQL[] {
  const conditions: SQL[] = [eq(assetAssets.tenantId, tenantId)];
  if (opts?.category) conditions.push(eq(assetAssets.categoryId, opts.category));
  if (opts?.status)   conditions.push(eq(assetAssets.status, opts.status));
  if (opts?.type)     conditions.push(eq(assetAssets.assetType, opts.type));
  if (opts?.search) {
    // GAP-ASSETS-INSURANCE-03: whole-word text match OR a case-insensitive substring of
    // name/code, so a picker typing "serv" finds "Server Rack" (tsvector matches whole words only).
    const like = `%${opts.search.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    conditions.push(sql`(to_tsvector('simple', ${assetAssets.name} || ' ' || ${assetAssets.code}) @@ plainto_tsquery('simple', ${opts.search}) OR ${assetAssets.name} ILIKE ${like} OR ${assetAssets.code} ILIKE ${like})`);
  }
  return conditions;
}

/** GAP-ASSETS-LIST-06: the total number of assets matching the same filters as the list (no paging). */
export async function countAssetsByTenant(tenantId: string, opts?: AssetFilter): Promise<number> {
  const rows = await scopedRead((tx) => tx.select({ n: sql<number>`count(*)::int` }).from(assetAssets)
    .where(and(...assetConditions(tenantId, opts))));
  return rows[0]?.n ?? 0;
}

export async function findAssetsByTenant(tenantId: string, opts?: AssetFilter & { limit?: number; offset?: number }): Promise<AssetRow[]> {
  const conditions = assetConditions(tenantId, opts);
  // scopedRead() so wrapWithTenantGuc injects app.tenant_id before this
  // read — a bare db.select() runs with no RLS GUC set.
  return scopedRead((tx) => tx.select().from(assetAssets)
    .where(and(...conditions))
    // GAP-ASSETS-FIXED-ASSETS-06: a stable order, otherwise limit/offset paging
    // can repeat or skip rows between pages.
    .orderBy(asc(assetAssets.code), asc(assetAssets.id))
    .limit(opts?.limit ?? 50)
    .offset(opts?.offset ?? 0));
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

export async function findCategoriesByTenant(tenantId: string): Promise<CategoryRow[]> {
  return scopedRead((tx) => tx.select().from(assetCategories)
    .where(eq(assetCategories.tenantId, tenantId)));
}

export async function findCategoryById(id: string, tenantId: string): Promise<CategoryRow | null> {
  const rows = await scopedRead((tx) => tx.select().from(assetCategories)
    .where(and(eq(assetCategories.id, id), eq(assetCategories.tenantId, tenantId))).limit(1));
  return rows[0] ?? null;
}

// P0: like updateAssetStatus/updateAssetBookValue/updateAssetLocation/
// updateAssetBarcode above, this MUST take an already-open tx and run inside
// the caller's db.transaction() — a bare db.update() runs with no RLS GUC
// set (wrapWithTenantGuc only hooks db.transaction()), so under FORCE RLS
// register.asset_categories's tenant_isolation_policy never matches and the
// UPDATE silently affects zero rows while the route still returns 200. Also
// bumps `version` so a persisted update is observable end-to-end (name,
// updatedAt, version), matching what the column exists for.
export async function updateCategory(tx: Writer, id: string, tenantId: string, patch: Partial<CategoryInsert>, actorId: string): Promise<void> {
  await (tx as typeof db).update(assetCategories)
    .set({ ...patch, updatedAt: new Date(), updatedBy: actorId, version: sql`${assetCategories.version} + 1` })
    .where(and(eq(assetCategories.id, id), eq(assetCategories.tenantId, tenantId)));
}
