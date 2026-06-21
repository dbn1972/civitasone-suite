import { eq, and, sql } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { auditParas } from "../para/schema.js";
import { auditRisks } from "../risk/schema.js";

export async function getDashboard(tenantId: string) {
  const [openObs] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(auditParas)
    .where(and(eq(auditParas.tenantId, tenantId), eq(auditParas.status, "open")));

  const [openRisks] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(auditRisks)
    .where(and(eq(auditRisks.tenantId, tenantId), eq(auditRisks.status, "open")));

  return {
    openObservations: openObs?.count ?? 0,
    riskRegisterItems: openRisks?.count ?? 0,
    cagParas: openObs?.count ?? 0,
    compliancePct: 0,
  };
}
