/**
 * predictive/repo.ts — CR-AI-01 database operations for predictive model scores.
 * Every query is filtered by tenant_id in addition to RLS.
 */
import { and, asc, desc, eq, gte, sql, type SQL } from "drizzle-orm";
import { scopedRead, type ScopedTx } from "../../shared/db.js";
import { toIso } from "../../shared/iso.js";
import { predictiveScores, type PredictiveScoreRow, type PredictiveScoreInsert } from "./schema.js";

export function toView(r: PredictiveScoreRow) {
  return {
    id: r.id,
    tenantId: r.tenantId,
    subjectType: r.subjectType,
    subjectId: r.subjectId,
    modelType: r.modelType,
    /**
     * numeric comes back from Postgres as a STRING and stays a string in JSON.
     * Do NOT cast to `number` — that is exactly how precision gets silently
     * lost (binary float rounding, and the 2^53 ceiling on large LTV values).
     */
    score: r.score,
    /** Also numeric — same rule as `score`: keep the string. */
    confidence: r.confidence,
    modelVersion: r.modelVersion,
    features: r.features,
    computedAt: toIso(r.computedAt),
    createdAt: toIso(r.createdAt),
    updatedAt: toIso(r.updatedAt),
    version: r.version,
  };
}

export type PredictiveScoreView = ReturnType<typeof toView>;

export async function findBySubjectModel(
  tenantId: string,
  subjectType: string,
  subjectId: string,
  modelType: string,
): Promise<PredictiveScoreRow | null> {
  const rows = await scopedRead((tx) =>
    tx
      .select()
      .from(predictiveScores)
      .where(
        and(
          eq(predictiveScores.tenantId, tenantId),
          eq(predictiveScores.subjectType, subjectType),
          eq(predictiveScores.subjectId, subjectId),
          eq(predictiveScores.modelType, modelType),
        ),
      )
      .limit(1),
  );
  return rows[0] ?? null;
}

/** All model scores for one subject, ordered by model type for a stable response. */
export async function listBySubject(
  tenantId: string,
  subjectType: string,
  subjectId: string,
): Promise<PredictiveScoreRow[]> {
  return scopedRead((tx) =>
    tx
      .select()
      .from(predictiveScores)
      .where(
        and(
          eq(predictiveScores.tenantId, tenantId),
          eq(predictiveScores.subjectType, subjectType),
          eq(predictiveScores.subjectId, subjectId),
        ),
      )
      .orderBy(asc(predictiveScores.modelType)),
  );
}

export interface RankedFilters {
  modelType?: string;
  /** Decimal string — compared in SQL so numeric stays numeric. */
  minScore?: string;
  subjectType?: string;
}

export async function listRanked(
  tenantId: string,
  limit: number,
  offset: number,
  filters: RankedFilters = {},
): Promise<{ rows: PredictiveScoreRow[]; total: number }> {
  const conditions: SQL[] = [eq(predictiveScores.tenantId, tenantId)];

  if (filters.modelType !== undefined) {
    conditions.push(eq(predictiveScores.modelType, filters.modelType));
  }
  if (filters.subjectType !== undefined) {
    conditions.push(eq(predictiveScores.subjectType, filters.subjectType));
  }
  if (filters.minScore !== undefined) {
    // Bound as a parameter and cast in SQL: the comparison happens in numeric
    // space, never in JS float space.
    conditions.push(gte(predictiveScores.score, filters.minScore));
  }

  const where = and(...conditions);

  const rows = await scopedRead((tx) =>
    tx
      .select()
      .from(predictiveScores)
      .where(where)
      // subject_id is the documented stable tie-break for equal scores.
      .orderBy(desc(predictiveScores.score), asc(predictiveScores.subjectId))
      .limit(limit)
      .offset(offset),
  );

  const countResult = await scopedRead((tx) =>
    tx.select({ count: sql<number>`count(*)::int` }).from(predictiveScores).where(where),
  );
  const total = countResult[0]?.count ?? 0;

  return { rows, total };
}

/**
 * Upsert on (tenant_id, subject_type, subject_id, model_type) — ml-service
 * re-scores subjects on a schedule, so a fresh score replaces the previous one
 * and bumps `version` for optimistic-locking consumers downstream.
 */
export async function upsert(tx: ScopedTx, row: PredictiveScoreInsert): Promise<PredictiveScoreRow[]> {
  return tx
    .insert(predictiveScores)
    .values(row)
    .onConflictDoUpdate({
      target: [
        predictiveScores.tenantId,
        predictiveScores.subjectType,
        predictiveScores.subjectId,
        predictiveScores.modelType,
      ],
      set: {
        score: row.score,
        confidence: row.confidence ?? null,
        modelVersion: row.modelVersion ?? null,
        features: row.features ?? {},
        computedAt: row.computedAt ?? new Date(),
        updatedAt: new Date(),
        updatedBy: row.updatedBy,
        version: sql`${predictiveScores.version} + 1`,
      },
    })
    .returning();
}
