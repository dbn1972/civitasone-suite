/**
 * matrix/repo.ts — Database operations for the cross-sell matrix.
 * Every query is filtered by tenant_id in addition to RLS.
 */
import { and, asc, desc, eq, inArray, isNull, lte, gt, or, sql, type SQL } from "drizzle-orm";
import { scopedRead, type ScopedTx } from "../../shared/db.js";
import { toIso } from "../../shared/iso.js";
import { crossSellMatrix, type CrossSellMatrixRow, type CrossSellMatrixInsert } from "./schema.js";

export function toView(r: CrossSellMatrixRow) {
  return {
    id: r.id,
    tenantId: r.tenantId,
    triggerProductId: r.triggerProductId,
    recommendedProductId: r.recommendedProductId,
    segment: r.segment,
    channel: r.channel,
    priority: r.priority,
    /** XS-001 — basis points (10000 = 100%). Integer, so it stays a JSON number. */
    weightBps: r.weightBps,
    effectiveFrom: r.effectiveFrom === null ? null : toIso(r.effectiveFrom),
    effectiveTo: r.effectiveTo === null ? null : toIso(r.effectiveTo),
    createdAt: toIso(r.createdAt),
    updatedAt: toIso(r.updatedAt),
    version: r.version,
  };
}

export type CrossSellMatrixView = ReturnType<typeof toView>;

export async function findById(id: string, tenantId: string): Promise<CrossSellMatrixRow | null> {
  const rows = await scopedRead((tx) =>
    tx
      .select()
      .from(crossSellMatrix)
      .where(and(eq(crossSellMatrix.id, id), eq(crossSellMatrix.tenantId, tenantId)))
      .limit(1),
  );
  return rows[0] ?? null;
}

export interface ListFilters {
  triggerProductId?: string;
  segment?: string;
  channel?: string;
}

export async function listByTenant(
  tenantId: string,
  limit: number,
  offset: number,
  filters: ListFilters = {},
): Promise<{ rows: CrossSellMatrixRow[]; total: number }> {
  const conditions: SQL[] = [eq(crossSellMatrix.tenantId, tenantId)];

  if (filters.triggerProductId !== undefined) {
    conditions.push(eq(crossSellMatrix.triggerProductId, filters.triggerProductId));
  }
  if (filters.segment !== undefined) {
    conditions.push(eq(crossSellMatrix.segment, filters.segment));
  }
  if (filters.channel !== undefined) {
    conditions.push(eq(crossSellMatrix.channel, filters.channel));
  }

  const where = and(...conditions);

  const rows = await scopedRead((tx) =>
    tx
      .select()
      .from(crossSellMatrix)
      .where(where)
      .orderBy(desc(crossSellMatrix.priority), asc(crossSellMatrix.createdAt))
      .limit(limit)
      .offset(offset),
  );

  const countResult = await scopedRead((tx) =>
    tx.select({ count: sql<number>`count(*)::int` }).from(crossSellMatrix).where(where),
  );
  const total = countResult[0]?.count ?? 0;

  return { rows, total };
}

/**
 * Candidate rows for duplicate detection — narrowed to the same product pair so
 * the segment/channel comparison happens in the domain layer with consistent
 * normalisation rules.
 */
export async function findByProductPair(
  tenantId: string,
  triggerProductId: string,
  recommendedProductId: string,
): Promise<CrossSellMatrixRow[]> {
  return scopedRead((tx) =>
    tx
      .select()
      .from(crossSellMatrix)
      .where(
        and(
          eq(crossSellMatrix.tenantId, tenantId),
          eq(crossSellMatrix.triggerProductId, triggerProductId),
          eq(crossSellMatrix.recommendedProductId, recommendedProductId),
        ),
      ),
  );
}

/**
 * XS-001 — cells whose trigger product is one the customer holds AND whose
 * effective window contains `asOf`.
 *
 * The date window is filtered in SQL as well as re-checked in the domain: SQL
 * keeps the result set small (a national matrix can hold tens of thousands of
 * expired cells), the domain check is what the unit tests pin the semantics to.
 * Both use the same half-open [from, to) rule.
 */
export async function listEffectiveForTriggers(
  tenantId: string,
  triggerProductIds: readonly string[],
  asOf: Date,
  limit: number,
  filters: ListFilters = {},
): Promise<CrossSellMatrixRow[]> {
  if (triggerProductIds.length === 0) return [];

  const conditions: (SQL | undefined)[] = [
    eq(crossSellMatrix.tenantId, tenantId),
    inArray(crossSellMatrix.triggerProductId, [...triggerProductIds]),
    or(isNull(crossSellMatrix.effectiveFrom), lte(crossSellMatrix.effectiveFrom, asOf)),
    or(isNull(crossSellMatrix.effectiveTo), gt(crossSellMatrix.effectiveTo, asOf)),
  ];

  if (filters.segment !== undefined) conditions.push(eq(crossSellMatrix.segment, filters.segment));
  if (filters.channel !== undefined) conditions.push(eq(crossSellMatrix.channel, filters.channel));

  return scopedRead((tx) =>
    tx
      .select()
      .from(crossSellMatrix)
      .where(and(...conditions))
      .orderBy(desc(crossSellMatrix.priority), desc(crossSellMatrix.weightBps), asc(crossSellMatrix.id))
      .limit(limit),
  );
}

export async function insert(tx: ScopedTx, row: CrossSellMatrixInsert): Promise<void> {
  await tx.insert(crossSellMatrix).values(row);
}

/** Optimistic-locked update. Returns false on version mismatch or wrong tenant. */
export async function update(
  tx: ScopedTx,
  id: string,
  tenantId: string,
  patch: Partial<CrossSellMatrixInsert>,
  currentVersion: number,
): Promise<boolean> {
  const result = await tx
    .update(crossSellMatrix)
    .set({ ...patch, updatedAt: new Date(), version: sql`${crossSellMatrix.version} + 1` })
    .where(
      and(
        eq(crossSellMatrix.id, id),
        eq(crossSellMatrix.tenantId, tenantId),
        eq(crossSellMatrix.version, currentVersion),
      ),
    )
    .returning({ id: crossSellMatrix.id });
  return result.length > 0;
}

/** Remove a matrix rule. Configuration data, so a hard delete is intentional. */
export async function deleteById(tx: ScopedTx, id: string, tenantId: string): Promise<boolean> {
  const result = await tx
    .delete(crossSellMatrix)
    .where(and(eq(crossSellMatrix.id, id), eq(crossSellMatrix.tenantId, tenantId)))
    .returning({ id: crossSellMatrix.id });
  return result.length > 0;
}
