import { eq, and, sql, inArray, gte, lte } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { legalCases } from "../cases/schema.js";
import { legalHearings } from "../hearings/schema.js";
import { legalOrders } from "../hearings/schema.js";

// Active cases are those not yet disposed/settled — "pending", "appealed", "stayed"
const ACTIVE_STATUSES = ["pending", "appealed", "stayed"] as const;

export async function getDashboard(tenantId: string) {
  const [active] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(legalCases)
    .where(and(
      eq(legalCases.tenantId, tenantId),
      inArray(legalCases.status, [...ACTIVE_STATUSES]),
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
    ));

  const [ordersPending] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(legalOrders)
    .where(and(
      eq(legalOrders.tenantId, tenantId),
    ));

  return {
    activeCases: active?.count ?? 0,
    hearingsThisWeek: hearingsThisWeek?.count ?? 0,
    ordersPending: ordersPending?.count ?? 0,
    opinionsDue: 0,
  };
}
