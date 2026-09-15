import { eq, and, ilike, sql, type SQL } from "drizzle-orm";
import { scopedRead, type ScopedTx } from "../../shared/db.js";
import { products, type ProductRow, type ProductInsert } from "./schema.js";

export async function findById(id: string, tenantId: string): Promise<ProductRow | null> {
  const rows = await scopedRead((tx) =>
    tx.select().from(products)
      .where(and(eq(products.id, id), eq(products.tenantId, tenantId)))
      .limit(1),
  );
  return rows[0] ?? null;
}

export interface ListFilters {
  tenantId: string;
  limit: number;
  offset: number;
  lifecycleStatus?: string | undefined;
  lineId?: string | undefined;
  search?: string | undefined;
}

export async function listProducts(filters: ListFilters): Promise<{ rows: ProductRow[]; total: number }> {
  const conditions: SQL[] = [eq(products.tenantId, filters.tenantId)];
  if (filters.lifecycleStatus) {
    conditions.push(eq(products.lifecycleStatus, filters.lifecycleStatus));
  }
  if (filters.lineId) {
    conditions.push(eq(products.lineId, filters.lineId));
  }
  if (filters.search) {
    conditions.push(ilike(products.name, `%${filters.search}%`));
  }
  const where = and(...conditions)!;

  const [rows, countResult] = await scopedRead(async (tx) => {
    const data = await tx.select().from(products).where(where).limit(filters.limit).offset(filters.offset).orderBy(products.createdAt);
    const cnt = await tx.select({ count: sql<number>`count(*)::int` }).from(products).where(where);
    return [data, cnt] as const;
  });

  return { rows, total: countResult[0]?.count ?? 0 };
}

// PERF-006: feeds GET /v1/catalogue/products/tree, which builds a 4-level
// parent/child hierarchy (routes.ts's buildHierarchyTree) from the flat
// result -- unlike this file's other list function above, a tenant's
// products can't be split across pages here without either orphaning
// children whose parent landed on a different page, or breaking a
// multi-page client into re-stitching the tree itself. So instead of real
// pagination, this bounds the query with a generous hard cap: high enough
// that no real catalogue should ever hit it, but no longer a truly unbounded
// `db.select()...where(tenantId)` (gap report: repo.ts:47) that could return
// every row for a tenant regardless of size. routes.ts surfaces
// `meta.truncated` so a tenant that *does* hit the cap is visible rather
// than silently rendering an incomplete tree.
export const TREE_ROW_CAP = 5000;

export async function listByTenant(tenantId: string, limit: number = TREE_ROW_CAP): Promise<ProductRow[]> {
  return scopedRead((tx) =>
    tx.select().from(products).where(eq(products.tenantId, tenantId)).orderBy(products.name).limit(limit),
  );
}

export async function insertProduct(tx: ScopedTx, row: ProductInsert): Promise<void> {
  await tx.insert(products).values(row);
}

/**
 * Optimistic-locked update. Returns false when the expected version no longer
 * matches (0 rows updated) so the route can answer 409 instead of silently
 * overwriting a concurrent writer. Version bump is computed by the DB.
 */
export async function updateProduct(tx: ScopedTx, id: string, tenantId: string, patch: Partial<ProductInsert>, expectedVersion: number): Promise<boolean> {
  const result = await tx.update(products)
    .set({ ...patch, updatedAt: new Date(), version: sql`${products.version} + 1` })
    .where(and(eq(products.id, id), eq(products.tenantId, tenantId), eq(products.version, expectedVersion)))
    .returning({ id: products.id });
  return result.length > 0;
}

export async function softDelete(tx: ScopedTx, id: string, tenantId: string, expectedVersion: number): Promise<boolean> {
  const result = await tx.update(products)
    .set({ lifecycleStatus: "withdrawn", updatedAt: new Date(), version: sql`${products.version} + 1` })
    .where(and(eq(products.id, id), eq(products.tenantId, tenantId), eq(products.version, expectedVersion)))
    .returning({ id: products.id });
  return result.length > 0;
}

export async function findByIds(ids: string[], tenantId: string): Promise<ProductRow[]> {
  if (ids.length === 0) return [];
  return scopedRead((tx) =>
    tx.select().from(products)
      .where(and(
        eq(products.tenantId, tenantId),
        sql`${products.id} = ANY(${ids})`,
      )),
  );
}
