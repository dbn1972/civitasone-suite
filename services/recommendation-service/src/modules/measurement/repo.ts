/**
 * measurement/repo.ts — XS-003 reads/writes for exposures and attributions.
 * Every query filters tenant_id explicitly in addition to RLS.
 */
import { and, asc, countDistinct, desc, eq, gte, lt, sql, type SQL } from "drizzle-orm";
import { scopedRead, type ScopedTx } from "../../shared/db.js";
import { toIso } from "../../shared/iso.js";
import {
  crossSellAttributions,
  crossSellExposures,
  type Cohort,
  type CrossSellAttributionInsert,
  type CrossSellAttributionRow,
  type CrossSellExposureInsert,
  type CrossSellExposureRow,
} from "./schema.js";
import type { CohortTally } from "./domain.js";

export function toAttributionView(r: CrossSellAttributionRow) {
  return {
    id: r.id,
    tenantId: r.tenantId,
    campaignKey: r.campaignKey,
    subjectId: r.subjectId,
    recommendationId: r.recommendationId,
    outcomeType: r.outcomeType,
    outcomeRef: r.outcomeRef,
    productId: r.productId,
    /** MONEY — string, always. */
    attributedAmountMinor: r.attributedAmountMinor.toString(),
    currency: r.currency,
    cohort: r.cohort,
    attributionModel: r.attributionModel,
    occurredAt: toIso(r.occurredAt),
    createdAt: toIso(r.createdAt),
    updatedAt: toIso(r.updatedAt),
    version: r.version,
  };
}

export function toExposureView(r: CrossSellExposureRow) {
  return {
    id: r.id,
    tenantId: r.tenantId,
    campaignKey: r.campaignKey,
    subjectId: r.subjectId,
    cohort: r.cohort,
    assignedAt: toIso(r.assignedAt),
    createdAt: toIso(r.createdAt),
    updatedAt: toIso(r.updatedAt),
    version: r.version,
  };
}

export interface WindowFilter {
  /** Inclusive lower bound on occurredAt. */
  from?: Date;
  /** Exclusive upper bound on occurredAt — half-open, so adjacent periods tile. */
  to?: Date;
}

/**
 * Counts for one cohort of one experiment.
 *
 * `converted` counts DISTINCT subjects, not attribution rows: attach rate answers
 * "what share of the people we recommended to took something", so a subject who
 * bought three times is one conversion. The value total still sums every row,
 * because revenue is revenue.
 */
export async function tallyCohort(
  tenantId: string,
  campaignKey: string,
  cohort: Cohort,
  window: WindowFilter = {},
): Promise<CohortTally> {
  const exposedResult = await scopedRead((tx) =>
    tx
      .select({ count: sql<number>`count(*)::int` })
      .from(crossSellExposures)
      .where(
        and(
          eq(crossSellExposures.tenantId, tenantId),
          eq(crossSellExposures.campaignKey, campaignKey),
          eq(crossSellExposures.cohort, cohort),
        ),
      ),
  );

  const conditions: (SQL | undefined)[] = [
    eq(crossSellAttributions.tenantId, tenantId),
    eq(crossSellAttributions.campaignKey, campaignKey),
    eq(crossSellAttributions.cohort, cohort),
  ];
  if (window.from !== undefined) {
    conditions.push(gte(crossSellAttributions.occurredAt, window.from));
  }
  if (window.to !== undefined) {
    conditions.push(lt(crossSellAttributions.occurredAt, window.to));
  }

  const convertedResult = await scopedRead((tx) =>
    tx
      .select({
        subjects: countDistinct(crossSellAttributions.subjectId),
        // COALESCE so an empty cohort yields 0 rather than NULL. ::text because a
        // bigint sum must not round-trip through a JS number.
        amount: sql<string>`coalesce(sum(${crossSellAttributions.attributedAmountMinor}), 0)::text`,
      })
      .from(crossSellAttributions)
      .where(and(...conditions)),
  );

  const converted = Number(convertedResult[0]?.subjects ?? 0);
  const rawAmount = convertedResult[0]?.amount ?? "0";

  return {
    exposed: exposedResult[0]?.count ?? 0,
    converted: Number.isFinite(converted) ? converted : 0,
    attributedAmountMinor: BigInt(rawAmount),
  };
}

export async function findAttributionByOutcome(
  tenantId: string,
  campaignKey: string,
  outcomeRef: string,
): Promise<CrossSellAttributionRow | null> {
  const rows = await scopedRead((tx) =>
    tx
      .select()
      .from(crossSellAttributions)
      .where(
        and(
          eq(crossSellAttributions.tenantId, tenantId),
          eq(crossSellAttributions.campaignKey, campaignKey),
          eq(crossSellAttributions.outcomeRef, outcomeRef),
        ),
      )
      .limit(1),
  );
  return rows[0] ?? null;
}

export async function findExposure(
  tenantId: string,
  campaignKey: string,
  subjectId: string,
): Promise<CrossSellExposureRow | null> {
  const rows = await scopedRead((tx) =>
    tx
      .select()
      .from(crossSellExposures)
      .where(
        and(
          eq(crossSellExposures.tenantId, tenantId),
          eq(crossSellExposures.campaignKey, campaignKey),
          eq(crossSellExposures.subjectId, subjectId),
        ),
      )
      .limit(1),
  );
  return rows[0] ?? null;
}

export interface ListAttributionFilters extends WindowFilter {
  campaignKey?: string;
  cohort?: Cohort;
  subjectId?: string;
}

export async function listAttributions(
  tenantId: string,
  limit: number,
  offset: number,
  filters: ListAttributionFilters = {},
): Promise<{ rows: CrossSellAttributionRow[]; total: number }> {
  const conditions: (SQL | undefined)[] = [eq(crossSellAttributions.tenantId, tenantId)];
  if (filters.campaignKey !== undefined) {
    conditions.push(eq(crossSellAttributions.campaignKey, filters.campaignKey));
  }
  if (filters.cohort !== undefined) conditions.push(eq(crossSellAttributions.cohort, filters.cohort));
  if (filters.subjectId !== undefined) {
    conditions.push(eq(crossSellAttributions.subjectId, filters.subjectId));
  }
  if (filters.from !== undefined) conditions.push(gte(crossSellAttributions.occurredAt, filters.from));
  if (filters.to !== undefined) conditions.push(lt(crossSellAttributions.occurredAt, filters.to));

  const where = and(...conditions);

  const rows = await scopedRead((tx) =>
    tx
      .select()
      .from(crossSellAttributions)
      .where(where)
      .orderBy(desc(crossSellAttributions.occurredAt), asc(crossSellAttributions.id))
      .limit(limit)
      .offset(offset),
  );

  const countResult = await scopedRead((tx) =>
    tx.select({ count: sql<number>`count(*)::int` }).from(crossSellAttributions).where(where),
  );

  return { rows, total: countResult[0]?.count ?? 0 };
}

export async function insertAttribution(
  tx: ScopedTx,
  row: CrossSellAttributionInsert,
): Promise<void> {
  await tx.insert(crossSellAttributions).values(row);
}

export async function insertExposure(tx: ScopedTx, row: CrossSellExposureInsert): Promise<void> {
  await tx.insert(crossSellExposures).values(row);
}
