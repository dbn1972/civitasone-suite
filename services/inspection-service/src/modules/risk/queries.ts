/**
 * inspection-service: risk module — read model / query handlers.
 *
 * Provides score history lookups for trend analysis.
 * Paginated responses follow standard CivitasOne envelope.
 *
 * _Requirements: 3.2, 3.3_
 */
import { eq, and, desc, sql } from "drizzle-orm";
import { scopedRead } from "../../shared/db.js";
import { riskScores, type RiskScoreRow } from "./schema.js";
import type { PaginationInput, PaginatedResult } from "./repo.js";

/**
 * Retrieve score history for a given entity, ordered most recent first.
 * Shows how risk score has changed over time (for trend calculation).
 */
export async function getScoreHistory(
  tenantId: string,
  entityId: string,
  pagination: PaginationInput,
): Promise<PaginatedResult<RiskScoreRow>> {
  return scopedRead(async (tx) => {
    const whereClause = and(
      eq(riskScores.tenantId, tenantId),
      eq(riskScores.entityId, entityId),
    );

    const [countResult, data] = await Promise.all([
      tx.select({ count: sql<number>`count(*)::int` })
        .from(riskScores)
        .where(whereClause),
      tx.select().from(riskScores)
        .where(whereClause)
        .limit(pagination.pageSize)
        .offset((pagination.page - 1) * pagination.pageSize)
        .orderBy(desc(riskScores.computedAt)),
    ]);

    const total = countResult[0]?.count ?? 0;

    return {
      data,
      meta: { page: pagination.page, pageSize: pagination.pageSize, total },
    };
  });
}
