/**
 * nba/repo.ts — Database operations for served recommendations.
 * Every query is filtered by tenant_id in addition to RLS.
 */
import { and, desc, eq, gte, inArray, sql, type SQL } from "drizzle-orm";
import { scopedRead, type ScopedTx } from "../../shared/db.js";
import { recommendations, type RecommendationRow, type RecommendationInsert } from "./schema.js";

export function toView(r: RecommendationRow) {
  return {
    id: r.id,
    tenantId: r.tenantId,
    profileId: r.profileId,
    recommendationType: r.recommendationType,
    productId: r.productId,
    channel: r.channel,
    /** numeric(5,4) is returned as a string by the driver — expose it as a number. */
    score: Number(r.score),
    status: r.status,
    servedAt: r.servedAt.toISOString(),
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    version: r.version,
  };
}

export type RecommendationView = ReturnType<typeof toView>;

export async function findById(id: string, tenantId: string): Promise<RecommendationRow | null> {
  const rows = await scopedRead((tx) =>
    tx
      .select()
      .from(recommendations)
      .where(and(eq(recommendations.id, id), eq(recommendations.tenantId, tenantId)))
      .limit(1),
  );
  return rows[0] ?? null;
}

export interface ProfileListFilters {
  /** Restrict to a single delivery channel. */
  channel?: string;
  /** Only statuses in this list (used to exclude terminal recommendations). */
  statuses?: string[];
  /** Only recommendations served at or after this instant (TTL window). */
  servedAfter?: Date;
}

export async function listForProfile(
  tenantId: string,
  profileId: string,
  limit: number,
  offset: number,
  filters: ProfileListFilters = {},
): Promise<{ rows: RecommendationRow[]; total: number }> {
  const conditions: SQL[] = [
    eq(recommendations.tenantId, tenantId),
    eq(recommendations.profileId, profileId),
  ];

  if (filters.statuses !== undefined && filters.statuses.length > 0) {
    conditions.push(inArray(recommendations.status, filters.statuses));
  }
  if (filters.channel !== undefined) {
    conditions.push(eq(recommendations.channel, filters.channel));
  }
  if (filters.servedAfter !== undefined) {
    conditions.push(gte(recommendations.servedAt, filters.servedAfter));
  }

  const where = and(...conditions);

  const rows = await scopedRead((tx) =>
    tx
      .select()
      .from(recommendations)
      .where(where)
      .orderBy(desc(recommendations.score), desc(recommendations.servedAt))
      .limit(limit)
      .offset(offset),
  );

  const countResult = await scopedRead((tx) =>
    tx.select({ count: sql<number>`count(*)::int` }).from(recommendations).where(where),
  );
  const total = countResult[0]?.count ?? 0;

  return { rows, total };
}

export async function insert(tx: ScopedTx, row: RecommendationInsert): Promise<void> {
  await tx.insert(recommendations).values(row);
}

/**
 * Optimistic-locked status update. Returns false when the row was concurrently
 * modified (version mismatch) or does not belong to the tenant.
 */
export async function updateStatus(
  tx: ScopedTx,
  id: string,
  tenantId: string,
  patch: Partial<RecommendationInsert>,
  currentVersion: number,
): Promise<boolean> {
  const result = await tx
    .update(recommendations)
    .set({ ...patch, updatedAt: new Date(), version: sql`${recommendations.version} + 1` })
    .where(
      and(
        eq(recommendations.id, id),
        eq(recommendations.tenantId, tenantId),
        eq(recommendations.version, currentVersion),
      ),
    )
    .returning({ id: recommendations.id });
  return result.length > 0;
}
