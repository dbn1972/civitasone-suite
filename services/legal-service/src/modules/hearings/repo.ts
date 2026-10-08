import { desc, eq, sql } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { legalHearings, legalOrders, legalOpinions, type HearingRow } from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export async function findHearingByIdTx(tx: Writer, id: string): Promise<HearingRow | null> {
  const rows = await (tx as typeof db).select().from(legalHearings).where(eq(legalHearings.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function insertHearing(tx: Writer, row: typeof legalHearings.$inferInsert): Promise<void> {
  await tx.insert(legalHearings).values(row);
}

export async function updateHearing(tx: Writer, id: string, patch: Partial<typeof legalHearings.$inferInsert>): Promise<void> {
  await tx.update(legalHearings).set({ ...patch, updatedAt: new Date() }).where(eq(legalHearings.id, id));
}

export async function insertOrder(tx: Writer, row: typeof legalOrders.$inferInsert): Promise<void> {
  await tx.insert(legalOrders).values(row);
}

export async function listHearingsByTenant(tenantId: string, limit: number): Promise<HearingRow[]> {
  return db.transaction(async (tx) =>
    tx.select().from(legalHearings).where(eq(legalHearings.tenantId, tenantId)).limit(limit));
}

export async function listOrdersByTenant(tenantId: string, limit: number) {
  return db.transaction(async (tx) =>
    tx.select().from(legalOrders).where(eq(legalOrders.tenantId, tenantId)).limit(limit));
}

/**
 * GAP2-LEGAL-COURT-ORDERS-10: page-aware list (limit + offset, newest order
 * first) so the compliance table is pageable instead of silently capped at
 * the first 50 rows.
 */
export async function listOrdersByTenantPaged(tenantId: string, limit: number, offset: number) {
  return db.transaction(async (tx) =>
    tx
      .select()
      .from(legalOrders)
      .where(eq(legalOrders.tenantId, tenantId))
      .orderBy(desc(legalOrders.orderDate))
      .limit(limit)
      .offset(offset));
}

/** GAP2-LEGAL-COURT-ORDERS-10: true total for the tenant (not the page size). */
export async function countOrdersByTenant(tenantId: string): Promise<number> {
  return db.transaction(async (tx) => {
    const rows = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(legalOrders)
      .where(eq(legalOrders.tenantId, tenantId));
    return rows[0]?.n ?? 0;
  });
}

/**
 * GAP2-LEGAL-COURT-ORDERS-10: compliance KPIs computed over the FULL tenant
 * set in SQL, never a 50-row page slice. `today` is the caller's IST calendar
 * date (YYYY-MM-DD); contempt risk is compliance-required orders whose
 * deadline is strictly before today. The orders table carries no status
 * column (reads project status as "pending"), so "complied" is 0 here and
 * every compliance-required order is still "due".
 */
export async function aggregateOrderStats(
  tenantId: string,
  today: string,
): Promise<{ total: number; pendingCompliance: number; complied: number; contemptRisk: number }> {
  return db.transaction(async (tx) => {
    const rows = await tx
      .select({
        total: sql<number>`count(*)::int`,
        pendingCompliance: sql<number>`count(*) filter (where ${legalOrders.complianceRequired})::int`,
        contemptRisk: sql<number>`count(*) filter (where ${legalOrders.complianceRequired} and ${legalOrders.complianceDeadline} is not null and ${legalOrders.complianceDeadline} < ${today})::int`,
      })
      .from(legalOrders)
      .where(eq(legalOrders.tenantId, tenantId));
    const r = rows[0];
    return {
      total: r?.total ?? 0,
      pendingCompliance: r?.pendingCompliance ?? 0,
      complied: 0,
      contemptRisk: r?.contemptRisk ?? 0,
    };
  });
}

export async function listOpinionsByTenant(tenantId: string, limit: number) {
  return db.transaction(async (tx) =>
    tx.select().from(legalOpinions).where(eq(legalOpinions.tenantId, tenantId)).limit(limit));
}
