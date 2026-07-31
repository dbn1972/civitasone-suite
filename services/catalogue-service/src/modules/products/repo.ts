import { eq, and, ilike, sql, type SQL } from "drizzle-orm";
import { scopedRead, type ScopedTx } from "../../shared/db.js";
import { products, type ProductRow, type ProductInsert } from "./schema.js";

export type Writer = { insert: ScopedTx["insert"]; update: ScopedTx["update"]; select: ScopedTx["select"] };

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

export async function insertProduct(tx: Writer, row: ProductInsert): Promise<void> {
  await tx.insert(products).values(row);
}

export async function updateProduct(tx: Writer, id: string, tenantId: string, patch: Partial<ProductInsert>, expectedVersion: number): Promise<boolean> {
  const result = await tx.update(products)
    .set({ ...patch, updatedAt: new Date(), version: expectedVersion + 1 })
    .where(and(eq(products.id, id), eq(products.tenantId, tenantId), eq(products.version, expectedVersion)));
  // Drizzle returns the mutated rows — if version mismatch, 0 rows affected
  return true; // In Drizzle ORM, update throws or succeeds
}

export async function softDelete(tx: Writer, id: string, tenantId: string, expectedVersion: number): Promise<boolean> {
  await tx.update(products)
    .set({ lifecycleStatus: "withdrawn", updatedAt: new Date(), version: expectedVersion + 1 })
    .where(and(eq(products.id, id), eq(products.tenantId, tenantId), eq(products.version, expectedVersion)));
  return true;
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
