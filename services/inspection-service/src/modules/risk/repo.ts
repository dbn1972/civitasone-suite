/**
 * inspection-service: risk module — data access (repository).
 *
 * Read-through via `cache.getOrLoad` for single-entity lookups.
 * All queries are scoped by tenant_id for RLS-compatible isolation.
 * Writes use Drizzle ORM within transaction contexts passed from the consumer.
 *
 * Cache key pattern: `inspection:{tenantId}:{resource}:{id}`
 *
 * _Requirements: 3.1, 3.2, 3.3_
 */
import { eq, and, desc, sql } from "drizzle-orm";
import { cache } from "../../shared/infra.js";
import { scopedRead, type Db } from "../../shared/db.js";
import {
  riskModels,
  riskScores,
  type RiskModelRow,
  type RiskModelInsert,
  type RiskScoreRow,
  type RiskScoreInsert,
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

// ── Risk Models ───────────────────────────────────────────────────────────────

/**
 * Find a risk model by ID with cache read-through.
 */
export async function findModelById(
  tenantId: string,
  id: string,
): Promise<RiskModelRow | null> {
  return cache.getOrLoad<RiskModelRow>(
    cache.makeKey(tenantId, "risk_model", id),
    async () => {
      const rows = await scopedRead((tx) =>
        tx.select().from(riskModels)
          .where(and(
            eq(riskModels.id, id),
            eq(riskModels.tenantId, tenantId),
          )),
      );
      return rows[0] ?? null;
    },
  );
}

/**
 * Paginated list of risk models for a tenant.
 * List queries go directly to Postgres (not cached individually).
 */
export async function findModelsByTenant(
  tenantId: string,
  pagination: PaginationInput,
): Promise<PaginatedResult<RiskModelRow>> {
  return scopedRead(async (tx) => {
    const whereClause = and(
      eq(riskModels.tenantId, tenantId),
      eq(riskModels.isActive, 1),
    );

    const [countResult, data] = await Promise.all([
      tx.select({ count: sql<number>`count(*)::int` })
        .from(riskModels)
        .where(whereClause),
      tx.select().from(riskModels)
        .where(whereClause)
        .limit(pagination.pageSize)
        .offset((pagination.page - 1) * pagination.pageSize)
        .orderBy(riskModels.createdAt),
    ]);

    const total = countResult[0]?.count ?? 0;

    return {
      data,
      meta: { page: pagination.page, pageSize: pagination.pageSize, total },
    };
  });
}

/**
 * Insert a new risk model within a transaction.
 */
export async function insertModel(
  tx: Tx,
  data: RiskModelInsert,
): Promise<RiskModelRow> {
  const rows = await tx.insert(riskModels).values(data).returning();
  return rows[0]!;
}

// ── Risk Scores ───────────────────────────────────────────────────────────────

/**
 * Find the most recent risk score for an entity with cache read-through.
 */
export async function findScoreByEntity(
  tenantId: string,
  entityId: string,
): Promise<RiskScoreRow | null> {
  return cache.getOrLoad<RiskScoreRow>(
    cache.makeKey(tenantId, "risk_score", entityId),
    async () => {
      const rows = await scopedRead((tx) =>
        tx.select().from(riskScores)
          .where(and(
            eq(riskScores.entityId, entityId),
            eq(riskScores.tenantId, tenantId),
          ))
          .orderBy(desc(riskScores.computedAt))
          .limit(1),
      );
      return rows[0] ?? null;
    },
  );
}

/**
 * Insert a new risk score within a transaction.
 */
export async function insertScore(
  tx: Tx,
  data: RiskScoreInsert,
): Promise<RiskScoreRow> {
  const rows = await tx.insert(riskScores).values(data).returning();
  return rows[0]!;
}

/**
 * Find the active (most recent, non-deactivated) risk model for a tenant.
 * Used by the consumer when no explicit modelId is specified.
 */
export async function findActiveModelByTenant(
  tenantId: string,
): Promise<RiskModelRow | null> {
  const rows = await scopedRead((tx) =>
    tx.select().from(riskModels)
      .where(and(
        eq(riskModels.tenantId, tenantId),
        eq(riskModels.isActive, 1),
      ))
      .orderBy(desc(riskModels.createdAt))
      .limit(1),
  );
  return rows[0] ?? null;
}
