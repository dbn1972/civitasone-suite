import { eq, and, ne, sql } from "drizzle-orm";
import { scopedRead, type ScopedTx } from "../../shared/db.js";
import { bundles, type BundleRow, type BundleInsert } from "./schema.js";

export async function findById(id: string, tenantId: string): Promise<BundleRow | null> {
  const rows = await scopedRead((tx) =>
    tx.select().from(bundles)
      .where(and(eq(bundles.id, id), eq(bundles.tenantId, tenantId), ne(bundles.status, "deleted")))
      .limit(1),
  );
  return rows[0] ?? null;
}

export interface BundleListFilters {
  tenantId: string;
  limit: number;
  offset: number;
}

export async function listBundles(filters: BundleListFilters): Promise<{ rows: BundleRow[]; total: number }> {
  const where = and(eq(bundles.tenantId, filters.tenantId), ne(bundles.status, "deleted"))!;

  const [rows, countResult] = await scopedRead(async (tx) => {
    const data = await tx.select().from(bundles).where(where).limit(filters.limit).offset(filters.offset).orderBy(bundles.createdAt);
    const cnt = await tx.select({ count: sql<number>`count(*)::int` }).from(bundles).where(where);
    return [data, cnt] as const;
  });

  return { rows, total: countResult[0]?.count ?? 0 };
}

export async function insertBundle(tx: ScopedTx, row: BundleInsert): Promise<void> {
  await tx.insert(bundles).values(row);
}

/**
 * Optimistic-locked update. Returns false when the expected version no longer
 * matches (0 rows updated) so the route can answer 409.
 */
export async function updateBundle(tx: ScopedTx, id: string, tenantId: string, patch: Partial<BundleInsert>, expectedVersion: number): Promise<boolean> {
  const result = await tx.update(bundles)
    .set({ ...patch, updatedAt: new Date(), version: sql`${bundles.version} + 1` })
    .where(and(eq(bundles.id, id), eq(bundles.tenantId, tenantId), eq(bundles.version, expectedVersion)))
    .returning({ id: bundles.id });
  return result.length > 0;
}

export async function softDeleteBundle(tx: ScopedTx, id: string, tenantId: string, expectedVersion: number): Promise<boolean> {
  const result = await tx.update(bundles)
    .set({ status: "deleted", updatedAt: new Date(), version: sql`${bundles.version} + 1` })
    .where(and(eq(bundles.id, id), eq(bundles.tenantId, tenantId), eq(bundles.version, expectedVersion)))
    .returning({ id: bundles.id });
  return result.length > 0;
}
