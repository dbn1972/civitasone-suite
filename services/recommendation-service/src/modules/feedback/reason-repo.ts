/**
 * feedback/reason-repo.ts — CR-AI-03 aggregate reads over structured rejection
 * reasons. Separate from repo.ts so the existing feedback module contract is
 * untouched.
 */
import { and, desc, eq, gte, isNotNull, lte, sql, type SQL } from "drizzle-orm";
import { scopedRead } from "../../shared/db.js";
import { recommendationFeedback } from "./schema.js";

export interface SummaryFilters {
  /** Inclusive lower bound on recorded_at. */
  from?: Date;
  /** Inclusive upper bound on recorded_at. */
  to?: Date;
}

/**
 * Rejection counts grouped by reason_code. Aggregated in SQL (GROUP BY) rather
 * than by loading rows: the feedback table grows without bound and this powers a
 * dashboard tile.
 */
export async function rejectionSummary(
  tenantId: string,
  filters: SummaryFilters = {},
): Promise<{ reasonCode: string; count: number }[]> {
  const conditions: SQL[] = [
    eq(recommendationFeedback.tenantId, tenantId),
    eq(recommendationFeedback.action, "rejected"),
    // Legacy rows have no code; they are reported separately by totalRejections.
    isNotNull(recommendationFeedback.reasonCode),
  ];

  if (filters.from !== undefined) {
    conditions.push(gte(recommendationFeedback.recordedAt, filters.from));
  }
  if (filters.to !== undefined) {
    conditions.push(lte(recommendationFeedback.recordedAt, filters.to));
  }

  const rows = await scopedRead((tx) =>
    tx
      .select({
        reasonCode: recommendationFeedback.reasonCode,
        count: sql<number>`count(*)::int`,
      })
      .from(recommendationFeedback)
      .where(and(...conditions))
      .groupBy(recommendationFeedback.reasonCode)
      .orderBy(desc(sql`count(*)`)),
  );

  return rows.map((r) => ({ reasonCode: r.reasonCode ?? "unspecified", count: r.count }));
}

/** Total rejections, including legacy rows with no structured reason code. */
export async function totalRejections(tenantId: string, filters: SummaryFilters = {}): Promise<number> {
  const conditions: SQL[] = [
    eq(recommendationFeedback.tenantId, tenantId),
    eq(recommendationFeedback.action, "rejected"),
  ];
  if (filters.from !== undefined) {
    conditions.push(gte(recommendationFeedback.recordedAt, filters.from));
  }
  if (filters.to !== undefined) {
    conditions.push(lte(recommendationFeedback.recordedAt, filters.to));
  }

  const rows = await scopedRead((tx) =>
    tx
      .select({ count: sql<number>`count(*)::int` })
      .from(recommendationFeedback)
      .where(and(...conditions)),
  );
  return rows[0]?.count ?? 0;
}
