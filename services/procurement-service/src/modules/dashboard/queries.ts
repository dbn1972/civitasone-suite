import { eq, and, or, sql } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { procurementIndents } from "../indent/schema.js";
import { procurementPos } from "../po/schema.js";
import { procurementGrns } from "../grn/schema.js";

export async function getDashboard(tenantId: string) {
  const [pendingIndents] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(procurementIndents)
    .where(and(
      eq(procurementIndents.tenantId, tenantId),
      or(eq(procurementIndents.status, "draft"), eq(procurementIndents.status, "pending")),
    ));

  const [activePos] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(procurementPos)
    .where(and(eq(procurementPos.tenantId, tenantId), eq(procurementPos.status, "approved")));

  const [grns] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(procurementGrns)
    .where(eq(procurementGrns.tenantId, tenantId));

  return {
    pendingIndents: pendingIndents?.count ?? 0,
    activePOs: activePos?.count ?? 0,
    grnsThisMonth: grns?.count ?? 0,
    contractRenewalsDue: 0,
  };
}
