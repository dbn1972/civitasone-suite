import { eq, and, sql } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { auditParas } from "../para/schema.js";

export async function getDashboard(tenantId: string) {
  const [openObs] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(auditParas)
    .where(and(eq(auditParas.tenantId, tenantId), eq(auditParas.status, "open")));

  return {
    openObservations: openObs?.count ?? 0,
    riskRegisterItems: 0,
    cagParas: openObs?.count ?? 0,
    compliancePct: 0,
  };
}
