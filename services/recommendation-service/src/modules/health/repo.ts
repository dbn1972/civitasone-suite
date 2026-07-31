/**
 * health/repo.ts — Database operations for account health scores.
 * Scores are append-only: each recompute inserts a new row so history is kept.
 * Every query is filtered by tenant_id in addition to RLS.
 */
import { and, desc, eq, sql, type SQL } from "drizzle-orm";
import { scopedRead, type ScopedTx } from "../../shared/db.js";
import { healthScores, type HealthScoreRow, type HealthScoreInsert } from "./schema.js";

export function toView(r: HealthScoreRow) {
  return {
    id: r.id,
    tenantId: r.tenantId,
    accountId: r.accountId,
    score: r.score,
    factors: r.factors,
    computedAt: r.computedAt.toISOString(),
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    version: r.version,
  };
}

export type HealthScoreView = ReturnType<typeof toView>;

export async function findById(id: string, tenantId: string): Promise<HealthScoreRow | null> {
  const rows = await scopedRead((tx) =>
    tx
      .select()
      .from(healthScores)
      .where(and(eq(healthScores.id, id), eq(healthScores.tenantId, tenantId)))
      .limit(1),
  );
  return rows[0] ?? null;
}

/** Most recently computed score for an account, or null when never computed. */
export async function findLatestByAccount(
  accountId: string,
  tenantId: string,
): Promise<HealthScoreRow | null> {
  const rows = await scopedRead((tx) =>
    tx
      .select()
      .from(healthScores)
      .where(and(eq(healthScores.tenantId, tenantId), eq(healthScores.accountId, accountId)))
      .orderBy(desc(healthScores.computedAt))
      .limit(1),
  );
  return rows[0] ?? null;
}

export async function listHistory(
  tenantId: string,
  accountId: string,
  limit: number,
  offset: number,
): Promise<{ rows: HealthScoreRow[]; total: number }> {
  const conditions: SQL[] = [eq(healthScores.tenantId, tenantId), eq(healthScores.accountId, accountId)];
  const where = and(...conditions);

  const rows = await scopedRead((tx) =>
    tx
      .select()
      .from(healthScores)
      .where(where)
      .orderBy(desc(healthScores.computedAt))
      .limit(limit)
      .offset(offset),
  );

  const countResult = await scopedRead((tx) =>
    tx.select({ count: sql<number>`count(*)::int` }).from(healthScores).where(where),
  );
  const total = countResult[0]?.count ?? 0;

  return { rows, total };
}

export async function insert(tx: ScopedTx, row: HealthScoreInsert): Promise<void> {
  await tx.insert(healthScores).values(row);
}

/** Optimistic-locked update. Returns false on version mismatch or wrong tenant. */
export async function update(
  tx: ScopedTx,
  id: string,
  tenantId: string,
  patch: Partial<HealthScoreInsert>,
  currentVersion: number,
): Promise<boolean> {
  const result = await tx
    .update(healthScores)
    .set({ ...patch, updatedAt: new Date(), version: sql`${healthScores.version} + 1` })
    .where(
      and(
        eq(healthScores.id, id),
        eq(healthScores.tenantId, tenantId),
        eq(healthScores.version, currentVersion),
      ),
    )
    .returning({ id: healthScores.id });
  return result.length > 0;
}
