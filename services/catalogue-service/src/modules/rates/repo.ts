import { eq, and, sql, lte, type SQL } from "drizzle-orm";
import { scopedRead, type ScopedTx } from "../../shared/db.js";
import { rates, type RateRow, type RateInsert } from "./schema.js";

export async function findById(id: string, tenantId: string): Promise<RateRow | null> {
  const rows = await scopedRead((tx) =>
    tx.select().from(rates)
      .where(and(eq(rates.id, id), eq(rates.tenantId, tenantId)))
      .limit(1),
  );
  return rows[0] ?? null;
}

export interface RateListFilters {
  tenantId: string;
  productId: string;
  limit: number;
  offset: number;
  date?: string | undefined;
}

export async function listRates(filters: RateListFilters): Promise<{ rows: RateRow[]; total: number }> {
  const conditions: SQL[] = [
    eq(rates.tenantId, filters.tenantId),
    eq(rates.productId, filters.productId),
  ];
  if (filters.date) {
    conditions.push(lte(rates.effectiveDate, filters.date));
  }
  const where = and(...conditions)!;

  const [rows, countResult] = await scopedRead(async (tx) => {
    const data = await tx.select().from(rates).where(where).limit(filters.limit).offset(filters.offset).orderBy(rates.effectiveDate);
    const cnt = await tx.select({ count: sql<number>`count(*)::int` }).from(rates).where(where);
    return [data, cnt] as const;
  });

  return { rows, total: countResult[0]?.count ?? 0 };
}

export async function findCurrentRate(productId: string, tenantId: string): Promise<RateRow | null> {
  const today = new Date().toISOString().split("T")[0]!;
  const rows = await scopedRead((tx) =>
    tx.select().from(rates)
      .where(and(
        eq(rates.tenantId, tenantId),
        eq(rates.productId, productId),
        lte(rates.effectiveDate, today),
      ))
      .orderBy(sql`${rates.effectiveDate} DESC`)
      .limit(1),
  );
  return rows[0] ?? null;
}

export async function insertRate(tx: ScopedTx, row: RateInsert): Promise<void> {
  await tx.insert(rates).values(row);
}

/**
 * Optimistic-locked update. Returns false when the expected version no longer
 * matches (0 rows updated) so the route can answer 409.
 */
export async function updateRate(tx: ScopedTx, id: string, tenantId: string, patch: Partial<RateInsert>, expectedVersion: number): Promise<boolean> {
  const result = await tx.update(rates)
    .set({ ...patch, updatedAt: new Date(), version: sql`${rates.version} + 1` })
    .where(and(eq(rates.id, id), eq(rates.tenantId, tenantId), eq(rates.version, expectedVersion)))
    .returning({ id: rates.id });
  return result.length > 0;
}
