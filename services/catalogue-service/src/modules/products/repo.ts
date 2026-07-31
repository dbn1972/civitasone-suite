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

export async function listByTenant(tenantId: string): Promise<ProductRow[]> {
  return scopedRead((tx) =>
    tx.select().from(products).where(eq(products.tenantId, tenantId)).orderBy(products.name),
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
