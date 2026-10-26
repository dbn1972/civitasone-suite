import { eq, and, sql, inArray, notInArray, gte, lte, type AnyColumn } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { legalCases } from "../cases/schema.js";
import { legalHearings } from "../hearings/schema.js";
import { legalOrders } from "../hearings/schema.js";

// Active cases are those not yet disposed/settled — "pending", "appealed", "stayed"
const ACTIVE_STATUSES = ["pending", "appealed", "stayed"] as const;

export async function getDashboard(tenantId: string, hiddenCaseIds: string[] = []) {
  // Bare `db.select()` outside a transaction does not carry the RLS tenant
  // GUC (every count came back 0 under RLS); read inside one transaction.
  return db.transaction((db) => getDashboardTx(db, tenantId, hiddenCaseIds));
}

async function getDashboardTx(db: Pick<typeof import("../../shared/db.js").db, "select">, tenantId: string, hiddenCaseIds: string[]) {
  // GAP-LEGAL-CASES-DETAIL-06: privileged cases the viewer may not see are excluded from every aggregate.
  const caseVisible = hiddenCaseIds.length ? notInArray(legalCases.id, hiddenCaseIds) : undefined;
  const childVisible = (col: AnyColumn) => (hiddenCaseIds.length ? notInArray(col, hiddenCaseIds) : undefined);
  const [active] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(legalCases)
    .where(and(
      eq(legalCases.tenantId, tenantId),
      inArray(legalCases.status, [...ACTIVE_STATUSES]),
      caseVisible,
    ));

  const now = new Date();
  const weekStart = new Date(now);
  weekStart.setDate(weekStart.getDate() - weekStart.getDay());
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 7);

  const [hearingsThisWeek] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(legalHearings)
    .where(and(
      eq(legalHearings.tenantId, tenantId),
      gte(legalHearings.hearingDate, weekStart.toISOString().slice(0, 10)),
      lte(legalHearings.hearingDate, weekEnd.toISOString().slice(0, 10)),
      eq(legalHearings.status, "scheduled"),
      childVisible(legalHearings.caseId),
    ));

  const [ordersPending] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(legalOrders)
    .where(and(
      eq(legalOrders.tenantId, tenantId),
      // Orders still requiring compliance action (matches the court-orders
      // KPI in hearings/repo.ts::aggregateOrderStats) — not every order.
      eq(legalOrders.complianceRequired, true),
      childVisible(legalOrders.caseId),
    ));

  // GAP-LEGAL-DASHBOARD-01: expose real disposed/total counts so the web
  // "disposal rate" KPI is computed from data, not fabricated.
  const [disposed] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(legalCases)
    .where(and(
      eq(legalCases.tenantId, tenantId),
      inArray(legalCases.status, ["disposed", "settled"]),
      caseVisible,
    ));

  const [total] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(legalCases)
    .where(and(eq(legalCases.tenantId, tenantId), caseVisible));

  return {
    activeCases: active?.count ?? 0,
    hearingsThisWeek: hearingsThisWeek?.count ?? 0,
    ordersPending: ordersPending?.count ?? 0,
    // No due-date column exists on opinions.legal_opinions, so "due" cannot be
    // computed. Return null (web shows a dash) rather than a fabricated 0.
    opinionsDue: null as number | null,
    disposedCases: disposed?.count ?? 0,
    totalCases: total?.count ?? 0,
  };
}
