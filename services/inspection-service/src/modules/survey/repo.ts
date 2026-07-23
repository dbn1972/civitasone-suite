/**
 * inspection-service: Survey module — data access (repository).
 *
 * _Requirements: SVC-104_
 */
import { eq, and, sql, desc } from "drizzle-orm";
import { cache } from "../../shared/infra.js";
import { scopedRead, type Db } from "../../shared/db.js";
import {
  surveyDefinitions,
  samplingFrames,
  surveyResponses,
  surveyAggregations,
  type SurveyDefinitionRow,
  type SurveyDefinitionInsert,
  type SamplingFrameRow,
  type SamplingFrameInsert,
  type SurveyResponseRow,
  type SurveyResponseInsert,
  type SurveyAggregationRow,
  type SurveyAggregationInsert,
} from "./schema.js";

// ── Type Aliases ──────────────────────────────────────────────────────────────

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export interface PaginationInput {
  page: number;
  pageSize: number;
}

export interface PaginatedResult<T> {
  data: T[];
  meta: { page: number; pageSize: number; total: number };
}

// ── Survey Definition Reads ───────────────────────────────────────────────────

export async function findSurveyById(
  tenantId: string,
  id: string,
): Promise<SurveyDefinitionRow | null> {
  return cache.getOrLoad<SurveyDefinitionRow>(
    cache.makeKey(tenantId, "survey", id),
    async () => {
      const rows = await scopedRead((tx) =>
        tx.select().from(surveyDefinitions)
          .where(and(
            eq(surveyDefinitions.id, id),
            eq(surveyDefinitions.tenantId, tenantId),
          )),
      );
      return rows[0] ?? null;
    },
  );
}

export async function findSurveys(
  tenantId: string,
  pagination: PaginationInput,
  filters?: {
    status?: string | undefined;
    targetEntityType?: string | undefined;
  },
): Promise<PaginatedResult<SurveyDefinitionRow>> {
  return scopedRead(async (tx) => {
    const conditions = [eq(surveyDefinitions.tenantId, tenantId)];

    if (filters?.status) {
      conditions.push(eq(surveyDefinitions.status, filters.status as "draft" | "active" | "closed"));
    }
    if (filters?.targetEntityType) {
      conditions.push(eq(surveyDefinitions.targetEntityType, filters.targetEntityType));
    }

    const whereClause = and(...conditions);

    const [countResult, data] = await Promise.all([
      tx.select({ count: sql<number>`count(*)::int` })
        .from(surveyDefinitions)
        .where(whereClause),
      tx.select().from(surveyDefinitions)
        .where(whereClause)
        .limit(pagination.pageSize)
        .offset((pagination.page - 1) * pagination.pageSize)
        .orderBy(desc(surveyDefinitions.createdAt)),
    ]);

    const total = countResult[0]?.count ?? 0;
    return { data, meta: { page: pagination.page, pageSize: pagination.pageSize, total } };
  });
}

// ── Aggregation Reads ─────────────────────────────────────────────────────────

export async function findLatestAggregation(
  tenantId: string,
  surveyId: string,
): Promise<SurveyAggregationRow | null> {
  return cache.getOrLoad<SurveyAggregationRow>(
    cache.makeKey(tenantId, "survey-agg", surveyId),
    async () => {
      const rows = await scopedRead((tx) =>
        tx.select().from(surveyAggregations)
          .where(and(
            eq(surveyAggregations.surveyId, surveyId),
            eq(surveyAggregations.tenantId, tenantId),
          ))
          .orderBy(desc(surveyAggregations.computedAt))
          .limit(1),
      );
      return rows[0] ?? null;
    },
  );
}

// ── Response Reads ────────────────────────────────────────────────────────────

export async function findResponsesBySurvey(
  tenantId: string,
  surveyId: string,
): Promise<SurveyResponseRow[]> {
  return scopedRead((tx) =>
    tx.select().from(surveyResponses)
      .where(and(
        eq(surveyResponses.surveyId, surveyId),
        eq(surveyResponses.tenantId, tenantId),
      ))
      .orderBy(desc(surveyResponses.capturedAt)),
  );
}

// ── Writes ────────────────────────────────────────────────────────────────────

export async function insertSurveyDefinition(
  tx: Tx,
  data: SurveyDefinitionInsert,
): Promise<SurveyDefinitionRow> {
  const rows = await tx.insert(surveyDefinitions).values(data).returning();
  return rows[0]!;
}

export async function updateSurveyDefinition(
  tx: Tx,
  id: string,
  tenantId: string,
  data: Partial<Omit<SurveyDefinitionInsert, "id" | "tenantId" | "createdAt" | "createdBy">>,
  expectedVersion: number,
): Promise<SurveyDefinitionRow> {
  const rows = await tx.update(surveyDefinitions)
    .set({
      ...data,
      updatedAt: new Date(),
      version: sql`${surveyDefinitions.version} + 1`,
    })
    .where(and(
      eq(surveyDefinitions.id, id),
      eq(surveyDefinitions.tenantId, tenantId),
      eq(surveyDefinitions.version, expectedVersion),
    ))
    .returning();

  if (rows.length === 0) {
    throw new Error(`Survey ${id} not found or version conflict (expected ${expectedVersion})`);
  }
  return rows[0]!;
}

export async function insertSamplingFrame(
  tx: Tx,
  data: SamplingFrameInsert,
): Promise<SamplingFrameRow> {
  const rows = await tx.insert(samplingFrames).values(data).returning();
  return rows[0]!;
}

export async function insertSurveyResponse(
  tx: Tx,
  data: SurveyResponseInsert,
): Promise<SurveyResponseRow> {
  const rows = await tx.insert(surveyResponses).values(data).returning();
  return rows[0]!;
}

export async function insertSurveyAggregation(
  tx: Tx,
  data: SurveyAggregationInsert,
): Promise<SurveyAggregationRow> {
  const rows = await tx.insert(surveyAggregations).values(data).returning();
  return rows[0]!;
}
