/**
 * Reads + optimistic-locked writes for the PC-001..PC-004 / PC-008 tables.
 * All reads go through scopedRead() so PostgreSQL RLS is enforced.
 */
import { eq, and, sql, isNotNull, lte, desc, asc, type SQL } from "drizzle-orm";
import { scopedRead, type ScopedTx } from "../../shared/db.js";
import {
  productVersions,
  productLifecycle,
  regulatoryMetadata,
  productAvailabilityV2,
  crossSellRules,
  type ProductVersionRow,
  type ProductVersionInsert,
  type ProductLifecycleRow,
  type ProductLifecycleInsert,
  type RegulatoryMetadataRow,
  type RegulatoryMetadataInsert,
  type ProductAvailabilityV2Row,
  type ProductAvailabilityV2Insert,
  type CrossSellRuleRow,
  type CrossSellRuleInsert,
} from "./governance-schema.js";

// ─── PC-001: product versions ──────────────────────────────────────────────────

export async function listVersions(
  productId: string,
  tenantId: string,
  limit: number,
  offset: number,
): Promise<{ rows: ProductVersionRow[]; total: number }> {
  const where = and(eq(productVersions.tenantId, tenantId), eq(productVersions.productId, productId))!;
  const [rows, cnt] = await scopedRead(async (tx) => {
    const data = await tx.select().from(productVersions).where(where)
      .orderBy(desc(productVersions.versionNumber)).limit(limit).offset(offset);
    const total = await tx.select({ count: sql<number>`count(*)::int` }).from(productVersions).where(where);
    return [data, total] as const;
  });
  return { rows, total: cnt[0]?.count ?? 0 };
}

export async function findVersionById(versionId: string, tenantId: string): Promise<ProductVersionRow | null> {
  const rows = await scopedRead((tx) =>
    tx.select().from(productVersions)
      .where(and(eq(productVersions.id, versionId), eq(productVersions.tenantId, tenantId)))
      .limit(1),
  );
  return rows[0] ?? null;
}

export async function listVersionNumbers(productId: string, tenantId: string): Promise<number[]> {
  const rows = await scopedRead((tx) =>
    tx.select({ n: productVersions.versionNumber }).from(productVersions)
      .where(and(eq(productVersions.tenantId, tenantId), eq(productVersions.productId, productId))),
  );
  return rows.map((r) => r.n);
}

export async function insertVersion(tx: ScopedTx, row: ProductVersionInsert): Promise<void> {
  await tx.insert(productVersions).values(row);
}

/**
 * Optimistic-locked status transition. Returns false when no row matched the
 * expected version, so the route answers 409 rather than clobbering a concurrent
 * approval.
 */
export async function updateVersionStatus(
  tx: ScopedTx,
  versionId: string,
  tenantId: string,
  patch: Partial<ProductVersionInsert>,
  expectedVersion: number,
): Promise<boolean> {
  const result = await tx.update(productVersions)
    .set({ ...patch, updatedAt: new Date(), version: sql`${productVersions.version} + 1` })
    .where(and(
      eq(productVersions.id, versionId),
      eq(productVersions.tenantId, tenantId),
      eq(productVersions.version, expectedVersion),
    ))
    .returning({ id: productVersions.id });
  return result.length > 0;
}

/** Latest approved version for a product — used by the PC-007 public projection. */
export async function findLatestApprovedVersion(productId: string, tenantId: string): Promise<ProductVersionRow | null> {
  const rows = await scopedRead((tx) =>
    tx.select().from(productVersions)
      .where(and(
        eq(productVersions.tenantId, tenantId),
        eq(productVersions.productId, productId),
        eq(productVersions.status, "approved"),
      ))
      .orderBy(desc(productVersions.versionNumber))
      .limit(1),
  );
  return rows[0] ?? null;
}

/** Product ids that currently have at least one approved version. */
export async function productIdsWithApprovedVersion(tenantId: string): Promise<string[]> {
  const rows = await scopedRead((tx) =>
    tx.selectDistinct({ productId: productVersions.productId }).from(productVersions)
      .where(and(eq(productVersions.tenantId, tenantId), eq(productVersions.status, "approved"))),
  );
  return rows.map((r) => r.productId);
}

// ─── PC-002: product lifecycle ─────────────────────────────────────────────────

export async function listLifecycleHistory(productId: string, tenantId: string): Promise<ProductLifecycleRow[]> {
  return scopedRead((tx) =>
    tx.select().from(productLifecycle)
      .where(and(eq(productLifecycle.tenantId, tenantId), eq(productLifecycle.productId, productId)))
      .orderBy(desc(productLifecycle.effectiveFrom), desc(productLifecycle.createdAt)),
  );
}

/** Current state = newest history row. Null when lifecycle tracking never began. */
export async function findCurrentLifecycle(productId: string, tenantId: string): Promise<ProductLifecycleRow | null> {
  const rows = await scopedRead((tx) =>
    tx.select().from(productLifecycle)
      .where(and(eq(productLifecycle.tenantId, tenantId), eq(productLifecycle.productId, productId)))
      .orderBy(desc(productLifecycle.effectiveFrom), desc(productLifecycle.createdAt))
      .limit(1),
  );
  return rows[0] ?? null;
}

export async function insertLifecycle(tx: ScopedTx, row: ProductLifecycleInsert): Promise<void> {
  await tx.insert(productLifecycle).values(row);
}

/** Product ids whose current lifecycle state is `active` (PC-007 filter). */
export async function activeLifecycleProductIds(tenantId: string): Promise<string[]> {
  const rows = await scopedRead((tx) =>
    tx.select({ productId: productLifecycle.productId, state: productLifecycle.state })
      .from(productLifecycle)
      .where(eq(productLifecycle.tenantId, tenantId))
      .orderBy(asc(productLifecycle.productId), desc(productLifecycle.effectiveFrom), desc(productLifecycle.createdAt)),
  );
  // Rows are ordered newest-first within each product, so the first row seen for
  // a product id is its current state.
  const current = new Map<string, string>();
  for (const row of rows) {
    if (!current.has(row.productId)) current.set(row.productId, row.state);
  }
  return [...current.entries()].filter(([, state]) => state === "active").map(([id]) => id);
}

// ─── PC-003: regulatory metadata ───────────────────────────────────────────────

export async function findRegulatory(productId: string, tenantId: string): Promise<RegulatoryMetadataRow | null> {
  const rows = await scopedRead((tx) =>
    tx.select().from(regulatoryMetadata)
      .where(and(eq(regulatoryMetadata.tenantId, tenantId), eq(regulatoryMetadata.productId, productId)))
      .limit(1),
  );
  return rows[0] ?? null;
}

export async function insertRegulatory(tx: ScopedTx, row: RegulatoryMetadataInsert): Promise<void> {
  await tx.insert(regulatoryMetadata).values(row);
}

export async function updateRegulatory(
  tx: ScopedTx,
  productId: string,
  tenantId: string,
  patch: Partial<RegulatoryMetadataInsert>,
  expectedVersion: number,
): Promise<boolean> {
  const result = await tx.update(regulatoryMetadata)
    .set({ ...patch, updatedAt: new Date(), version: sql`${regulatoryMetadata.version} + 1` })
    .where(and(
      eq(regulatoryMetadata.tenantId, tenantId),
      eq(regulatoryMetadata.productId, productId),
      eq(regulatoryMetadata.version, expectedVersion),
    ))
    .returning({ id: regulatoryMetadata.id });
  return result.length > 0;
}

/** Records whose regulatory validity ends on or before `cutoff`. */
export async function listExpiringRegulatory(
  tenantId: string,
  cutoff: Date,
  limit: number,
  offset: number,
): Promise<{ rows: RegulatoryMetadataRow[]; total: number }> {
  const where = and(
    eq(regulatoryMetadata.tenantId, tenantId),
    isNotNull(regulatoryMetadata.validUntil),
    lte(regulatoryMetadata.validUntil, cutoff),
  )!;
  const [rows, cnt] = await scopedRead(async (tx) => {
    const data = await tx.select().from(regulatoryMetadata).where(where)
      .orderBy(asc(regulatoryMetadata.validUntil)).limit(limit).offset(offset);
    const total = await tx.select({ count: sql<number>`count(*)::int` }).from(regulatoryMetadata).where(where);
    return [data, total] as const;
  });
  return { rows, total: cnt[0]?.count ?? 0 };
}

// ─── PC-004: availability v2 ───────────────────────────────────────────────────

export async function listAvailabilityV2(productId: string, tenantId: string): Promise<ProductAvailabilityV2Row[]> {
  return scopedRead((tx) =>
    tx.select().from(productAvailabilityV2)
      .where(and(eq(productAvailabilityV2.tenantId, tenantId), eq(productAvailabilityV2.productId, productId)))
      .orderBy(asc(productAvailabilityV2.createdAt)),
  );
}

/** Bulk replace: delete the product's rows then insert the new set, in one tx. */
export async function replaceAvailabilityV2(
  tx: ScopedTx,
  productId: string,
  tenantId: string,
  rows: ProductAvailabilityV2Insert[],
): Promise<number> {
  await tx.delete(productAvailabilityV2)
    .where(and(eq(productAvailabilityV2.tenantId, tenantId), eq(productAvailabilityV2.productId, productId)));
  if (rows.length === 0) return 0;
  await tx.insert(productAvailabilityV2).values(rows);
  return rows.length;
}

// ─── PC-008: cross-sell rules ──────────────────────────────────────────────────

export async function listCrossSell(
  sourceProductId: string,
  tenantId: string,
  enabledOnly: boolean,
): Promise<CrossSellRuleRow[]> {
  const conditions: SQL[] = [
    eq(crossSellRules.tenantId, tenantId),
    eq(crossSellRules.sourceProductId, sourceProductId),
  ];
  if (enabledOnly) conditions.push(eq(crossSellRules.enabled, true));
  return scopedRead((tx) =>
    tx.select().from(crossSellRules).where(and(...conditions)!)
      .orderBy(desc(crossSellRules.priority), asc(crossSellRules.createdAt)),
  );
}

export async function findCrossSellById(ruleId: string, tenantId: string): Promise<CrossSellRuleRow | null> {
  const rows = await scopedRead((tx) =>
    tx.select().from(crossSellRules)
      .where(and(eq(crossSellRules.id, ruleId), eq(crossSellRules.tenantId, tenantId)))
      .limit(1),
  );
  return rows[0] ?? null;
}

export async function insertCrossSell(tx: ScopedTx, row: CrossSellRuleInsert): Promise<void> {
  await tx.insert(crossSellRules).values(row);
}

/** Hard delete — a cross-sell rule is configuration, not user data. */
export async function deleteCrossSell(tx: ScopedTx, ruleId: string, tenantId: string): Promise<boolean> {
  const result = await tx.delete(crossSellRules)
    .where(and(eq(crossSellRules.id, ruleId), eq(crossSellRules.tenantId, tenantId)))
    .returning({ id: crossSellRules.id });
  return result.length > 0;
}
