/**
 * inspection-service: Enforcement module — data access (repository).
 *
 * Read-through via `cache.getOrLoad` for single-entity lookups.
 * All queries are scoped by tenant_id for RLS-compatible isolation.
 *
 * _Requirements: SVC-107_
 */
import { eq, and, sql, desc } from "drizzle-orm";
import { cache } from "../../shared/infra.js";
import { scopedRead, type Db } from "../../shared/db.js";
import {
  penaltyRates,
  showCauseNotices,
  penaltyOrders,
  prosecutionReferrals,
  type PenaltyRateRow,
  type PenaltyRateInsert,
  type ShowCauseNoticeRow,
  type ShowCauseNoticeInsert,
  type PenaltyOrderRow,
  type PenaltyOrderInsert,
  type ProsecutionReferralRow,
  type ProsecutionReferralInsert,
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

// ── Penalty Rate Reads ────────────────────────────────────────────────────────

export async function findPenaltyRates(
  tenantId: string,
  pagination: PaginationInput,
): Promise<PaginatedResult<PenaltyRateRow>> {
  return scopedRead(async (tx) => {
    const whereClause = eq(penaltyRates.tenantId, tenantId);

    const [countResult, data] = await Promise.all([
      tx.select({ count: sql<number>`count(*)::int` })
        .from(penaltyRates)
        .where(whereClause),
      tx.select().from(penaltyRates)
        .where(whereClause)
        .limit(pagination.pageSize)
        .offset((pagination.page - 1) * pagination.pageSize)
        .orderBy(desc(penaltyRates.createdAt)),
    ]);

    const total = countResult[0]?.count ?? 0;
    return { data, meta: { page: pagination.page, pageSize: pagination.pageSize, total } };
  });
}

// ── Penalty Rate Writes ───────────────────────────────────────────────────────

export async function insertPenaltyRate(
  tx: Tx,
  data: PenaltyRateInsert,
): Promise<PenaltyRateRow> {
  const rows = await tx.insert(penaltyRates).values(data).returning();
  return rows[0]!;
}

// ── Show Cause Reads ──────────────────────────────────────────────────────────

export async function findShowCauseById(
  tenantId: string,
  id: string,
): Promise<ShowCauseNoticeRow | null> {
  return cache.getOrLoad<ShowCauseNoticeRow>(
    cache.makeKey(tenantId, "show_cause", id),
    async () => {
      const rows = await scopedRead((tx) =>
        tx.select().from(showCauseNotices)
          .where(and(
            eq(showCauseNotices.id, id),
            eq(showCauseNotices.tenantId, tenantId),
          )),
      );
      return rows[0] ?? null;
    },
  );
}

// ── Show Cause Writes ─────────────────────────────────────────────────────────

export async function insertShowCauseNotice(
  tx: Tx,
  data: ShowCauseNoticeInsert,
): Promise<ShowCauseNoticeRow> {
  const rows = await tx.insert(showCauseNotices).values(data).returning();
  return rows[0]!;
}

export async function updateShowCauseNotice(
  tx: Tx,
  id: string,
  tenantId: string,
  data: Partial<Omit<ShowCauseNoticeInsert, "id" | "tenantId" | "createdAt" | "createdBy">>,
  expectedVersion: number,
): Promise<ShowCauseNoticeRow> {
  const rows = await tx.update(showCauseNotices)
    .set({
      ...data,
      updatedAt: new Date(),
      version: sql`${showCauseNotices.version} + 1`,
    })
    .where(and(
      eq(showCauseNotices.id, id),
      eq(showCauseNotices.tenantId, tenantId),
      eq(showCauseNotices.version, expectedVersion),
    ))
    .returning();

  if (rows.length === 0) {
    throw new Error(`Show cause notice ${id} not found or version conflict`);
  }
  return rows[0]!;
}

// ── Penalty Order Reads ───────────────────────────────────────────────────────

export async function findPenaltyOrderById(
  tenantId: string,
  id: string,
): Promise<PenaltyOrderRow | null> {
  return cache.getOrLoad<PenaltyOrderRow>(
    cache.makeKey(tenantId, "penalty_order", id),
    async () => {
      const rows = await scopedRead((tx) =>
        tx.select().from(penaltyOrders)
          .where(and(
            eq(penaltyOrders.id, id),
            eq(penaltyOrders.tenantId, tenantId),
          )),
      );
      return rows[0] ?? null;
    },
  );
}

export async function findPenaltyOrders(
  tenantId: string,
  pagination: PaginationInput,
  filters?: { status?: string | undefined; entityId?: string | undefined },
): Promise<PaginatedResult<PenaltyOrderRow>> {
  return scopedRead(async (tx) => {
    const conditions = [eq(penaltyOrders.tenantId, tenantId)];

    if (filters?.status) {
      conditions.push(eq(penaltyOrders.status, filters.status));
    }
    if (filters?.entityId) {
      conditions.push(eq(penaltyOrders.entityId, filters.entityId));
    }

    const whereClause = and(...conditions);

    const [countResult, data] = await Promise.all([
      tx.select({ count: sql<number>`count(*)::int` })
        .from(penaltyOrders)
        .where(whereClause),
      tx.select().from(penaltyOrders)
        .where(whereClause)
        .limit(pagination.pageSize)
        .offset((pagination.page - 1) * pagination.pageSize)
        .orderBy(desc(penaltyOrders.createdAt)),
    ]);

    const total = countResult[0]?.count ?? 0;
    return { data, meta: { page: pagination.page, pageSize: pagination.pageSize, total } };
  });
}

// ── Penalty Order Writes ──────────────────────────────────────────────────────

export async function insertPenaltyOrder(
  tx: Tx,
  data: PenaltyOrderInsert,
): Promise<PenaltyOrderRow> {
  const rows = await tx.insert(penaltyOrders).values(data).returning();
  return rows[0]!;
}

export async function updatePenaltyOrder(
  tx: Tx,
  id: string,
  tenantId: string,
  data: Partial<Omit<PenaltyOrderInsert, "id" | "tenantId" | "createdAt" | "createdBy">>,
  expectedVersion: number,
): Promise<PenaltyOrderRow> {
  const rows = await tx.update(penaltyOrders)
    .set({
      ...data,
      updatedAt: new Date(),
      version: sql`${penaltyOrders.version} + 1`,
    })
    .where(and(
      eq(penaltyOrders.id, id),
      eq(penaltyOrders.tenantId, tenantId),
      eq(penaltyOrders.version, expectedVersion),
    ))
    .returning();

  if (rows.length === 0) {
    throw new Error(`Penalty order ${id} not found or version conflict`);
  }
  return rows[0]!;
}

// ── Prosecution Referral Writes ───────────────────────────────────────────────

export async function insertProsecutionReferral(
  tx: Tx,
  data: ProsecutionReferralInsert,
): Promise<ProsecutionReferralRow> {
  const rows = await tx.insert(prosecutionReferrals).values(data).returning();
  return rows[0]!;
}
