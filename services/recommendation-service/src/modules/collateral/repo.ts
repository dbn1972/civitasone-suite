/**
 * collateral/repo.ts — CR-AI-02 database operations for collateral links.
 * Every query is filtered by tenant_id in addition to RLS.
 */
import { and, asc, eq, sql } from "drizzle-orm";
import { scopedRead, type ScopedTx } from "../../shared/db.js";
import { toIso } from "../../shared/iso.js";
import { collateralLinks, type CollateralLinkRow, type CollateralLinkInsert } from "./schema.js";

export function toView(r: CollateralLinkRow) {
  return {
    id: r.id,
    tenantId: r.tenantId,
    recommendationId: r.recommendationId,
    collateralType: r.collateralType,
    collateralRef: r.collateralRef,
    title: r.title,
    ordinal: r.ordinal,
    createdAt: toIso(r.createdAt),
    updatedAt: toIso(r.updatedAt),
    version: r.version,
  };
}

export type CollateralLinkView = ReturnType<typeof toView>;

export async function findById(id: string, tenantId: string): Promise<CollateralLinkRow | null> {
  const rows = await scopedRead((tx) =>
    tx
      .select()
      .from(collateralLinks)
      .where(and(eq(collateralLinks.id, id), eq(collateralLinks.tenantId, tenantId)))
      .limit(1),
  );
  return rows[0] ?? null;
}

/** Ordered deck for a recommendation — ordinal ascending, id as the stable tie-break. */
export async function listByRecommendation(
  tenantId: string,
  recommendationId: string,
  limit: number,
  offset: number,
): Promise<{ rows: CollateralLinkRow[]; total: number }> {
  const where = and(
    eq(collateralLinks.tenantId, tenantId),
    eq(collateralLinks.recommendationId, recommendationId),
  );

  const rows = await scopedRead((tx) =>
    tx
      .select()
      .from(collateralLinks)
      .where(where)
      .orderBy(asc(collateralLinks.ordinal), asc(collateralLinks.id))
      .limit(limit)
      .offset(offset),
  );

  const countResult = await scopedRead((tx) =>
    tx.select({ count: sql<number>`count(*)::int` }).from(collateralLinks).where(where),
  );
  const total = countResult[0]?.count ?? 0;

  return { rows, total };
}

/** Every link for a recommendation — used to compute the next free ordinal. */
export async function listAllForRecommendation(
  tenantId: string,
  recommendationId: string,
): Promise<CollateralLinkRow[]> {
  return scopedRead((tx) =>
    tx
      .select()
      .from(collateralLinks)
      .where(
        and(
          eq(collateralLinks.tenantId, tenantId),
          eq(collateralLinks.recommendationId, recommendationId),
        ),
      )
      .orderBy(asc(collateralLinks.ordinal)),
  );
}

export async function insert(tx: ScopedTx, row: CollateralLinkInsert): Promise<void> {
  await tx.insert(collateralLinks).values(row);
}

/** Optimistic-locked update. Returns false on version mismatch or wrong tenant. */
export async function update(
  tx: ScopedTx,
  id: string,
  tenantId: string,
  patch: Partial<CollateralLinkInsert>,
  currentVersion: number,
): Promise<boolean> {
  const result = await tx
    .update(collateralLinks)
    .set({ ...patch, updatedAt: new Date(), version: sql`${collateralLinks.version} + 1` })
    .where(
      and(
        eq(collateralLinks.id, id),
        eq(collateralLinks.tenantId, tenantId),
        eq(collateralLinks.version, currentVersion),
      ),
    )
    .returning({ id: collateralLinks.id });
  return result.length > 0;
}

/**
 * Remove a link. Association/configuration data, not user content, so a hard
 * delete is intentional — the audit event carries the record of the removal.
 */
export async function deleteById(tx: ScopedTx, id: string, tenantId: string): Promise<boolean> {
  const result = await tx
    .delete(collateralLinks)
    .where(and(eq(collateralLinks.id, id), eq(collateralLinks.tenantId, tenantId)))
    .returning({ id: collateralLinks.id });
  return result.length > 0;
}
