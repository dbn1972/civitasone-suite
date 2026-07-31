import { eq, and, ne, sql } from "drizzle-orm";
import { scopedRead, type ScopedTx } from "../../shared/db.js";
import { bundles, type BundleRow, type BundleInsert } from "./schema.js";

export type Writer = { insert: ScopedTx["insert"]; update: ScopedTx["update"]; select: ScopedTx["select"] };

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

export async function insertBundle(tx: Writer, row: BundleInsert): Promise<void> {
  await tx.insert(bundles).values(row);
}

export async function updateBundle(tx: Writer, id: string, tenantId: string, patch: Partial<BundleInsert>, expectedVersion: number): Promise<boolean> {
  await tx.update(bundles)
    .set({ ...patch, updatedAt: new Date(), version: expectedVersion + 1 })
    .where(and(eq(bundles.id, id), eq(bundles.tenantId, tenantId), eq(bundles.version, expectedVersion)));
  return true;
}

export async function softDeleteBundle(tx: Writer, id: string, tenantId: string, expectedVersion: number): Promise<boolean> {
  await tx.update(bundles)
    .set({ status: "deleted", updatedAt: new Date(), version: expectedVersion + 1 })
    .where(and(eq(bundles.id, id), eq(bundles.tenantId, tenantId), eq(bundles.version, expectedVersion)));
  return true;
}
