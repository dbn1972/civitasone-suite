/**
 * feedback/repo.ts — Database operations for recommendation feedback.
 * Feedback rows are append-only. Every query is filtered by tenant_id.
 */
import { and, desc, eq, sql, type SQL } from "drizzle-orm";
import { scopedRead, type ScopedTx } from "../../shared/db.js";
import {
  recommendationFeedback,
  type RecommendationFeedbackRow,
  type RecommendationFeedbackInsert,
} from "./schema.js";

export function toView(r: RecommendationFeedbackRow) {
  return {
    id: r.id,
    tenantId: r.tenantId,
    recommendationId: r.recommendationId,
    action: r.action,
    reason: r.reason,
    recordedAt: r.recordedAt.toISOString(),
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    version: r.version,
  };
}

export type RecommendationFeedbackView = ReturnType<typeof toView>;

export async function findById(
  id: string,
  tenantId: string,
): Promise<RecommendationFeedbackRow | null> {
  const rows = await scopedRead((tx) =>
    tx
      .select()
      .from(recommendationFeedback)
      .where(and(eq(recommendationFeedback.id, id), eq(recommendationFeedback.tenantId, tenantId)))
      .limit(1),
  );
  return rows[0] ?? null;
}

export async function listByRecommendation(
  tenantId: string,
  recommendationId: string,
  limit: number,
  offset: number,
): Promise<{ rows: RecommendationFeedbackRow[]; total: number }> {
  const conditions: SQL[] = [
    eq(recommendationFeedback.tenantId, tenantId),
    eq(recommendationFeedback.recommendationId, recommendationId),
  ];
  const where = and(...conditions);

  const rows = await scopedRead((tx) =>
    tx
      .select()
      .from(recommendationFeedback)
      .where(where)
      .orderBy(desc(recommendationFeedback.recordedAt))
      .limit(limit)
      .offset(offset),
  );

  const countResult = await scopedRead((tx) =>
    tx.select({ count: sql<number>`count(*)::int` }).from(recommendationFeedback).where(where),
  );
  const total = countResult[0]?.count ?? 0;

  return { rows, total };
}

export async function insert(tx: ScopedTx, row: RecommendationFeedbackInsert): Promise<void> {
  await tx.insert(recommendationFeedback).values(row);
}

/** Optimistic-locked update. Returns false on version mismatch or wrong tenant. */
export async function update(
  tx: ScopedTx,
  id: string,
  tenantId: string,
  patch: Partial<RecommendationFeedbackInsert>,
  currentVersion: number,
): Promise<boolean> {
  const result = await tx
    .update(recommendationFeedback)
    .set({ ...patch, updatedAt: new Date(), version: sql`${recommendationFeedback.version} + 1` })
    .where(
      and(
        eq(recommendationFeedback.id, id),
        eq(recommendationFeedback.tenantId, tenantId),
        eq(recommendationFeedback.version, currentVersion),
      ),
    )
    .returning({ id: recommendationFeedback.id });
  return result.length > 0;
}
