import { eq, and, sql } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { legalCases } from "../cases/schema.js";

export async function getDashboard(tenantId: string) {
  const [active] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(legalCases)
    .where(and(eq(legalCases.tenantId, tenantId), eq(legalCases.status, "active")));

  return {
    activeCases: active?.count ?? 0,
    hearingsThisWeek: 0,
    ordersPending: 0,
    opinionsDue: 0,
  };
}
