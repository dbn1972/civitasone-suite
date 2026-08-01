/** PC-005 — reads/writes for rates that are mastered in an external system. */
import { eq, and, sql, isNotNull, asc, type SQL } from "drizzle-orm";
import { scopedRead, type ScopedTx } from "../../shared/db.js";
import { rates, type RateRow, type RateInsert } from "./schema.js";

export interface ExternalRefFilters {
  tenantId: string;
  limit: number;
  offset: number;
  sourceSystem?: string | undefined;
  productId?: string | undefined;
}

/** Only rates that declare an external master are listed. */
export async function listExternalRefs(filters: ExternalRefFilters): Promise<{ rows: RateRow[]; total: number }> {
  const conditions: SQL[] = [eq(rates.tenantId, filters.tenantId), isNotNull(rates.sourceSystem)];
  if (filters.sourceSystem !== undefined) conditions.push(eq(rates.sourceSystem, filters.sourceSystem));
  if (filters.productId !== undefined) conditions.push(eq(rates.productId, filters.productId));
  const where = and(...conditions)!;

  const [rows, cnt] = await scopedRead(async (tx) => {
    const data = await tx.select().from(rates).where(where)
      .orderBy(asc(rates.sourceSystem), asc(rates.externalId)).limit(filters.limit).offset(filters.offset);
    const total = await tx.select({ count: sql<number>`count(*)::int` }).from(rates).where(where);
    return [data, total] as const;
  });
  return { rows, total: cnt[0]?.count ?? 0 };
}

/**
 * Optimistic-locked write of the external-master reference.
 * Returns false when no row matched the expected version → 409.
 */
export async function setExternalRef(
  tx: ScopedTx,
  rateId: string,
  tenantId: string,
  ref: Pick<RateInsert, "sourceSystem" | "externalId" | "syncedAt" | "updatedBy">,
  expectedVersion: number,
): Promise<boolean> {
  const result = await tx.update(rates)
    .set({ ...ref, updatedAt: new Date(), version: sql`${rates.version} + 1` })
    .where(and(eq(rates.id, rateId), eq(rates.tenantId, tenantId), eq(rates.version, expectedVersion)))
    .returning({ id: rates.id });
  return result.length > 0;
}
