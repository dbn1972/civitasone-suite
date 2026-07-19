import { eq, and, sql } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { auditObservations } from "../observation/schema.js";
import { auditParas } from "../para/schema.js";
import { auditRisks } from "../risk/schema.js";

export async function getDashboard(tenantId: string) {
  // Wrapped in db.transaction() so wrapWithTenantGuc injects app.tenant_id
  // before these reads — bare db.select() calls run with no RLS GUC set.
  const { openObs, openParas, openRisks } = await db.transaction(async (tx) => {
    // NOTE: openObservations counts observation.audit_observations, not
    // para.audit_paras — the audit_paras_status_check CHECK constraint
    // (migration 0016) only permits draft/issued/replied/settled/
    // pending_recovery/closed, so a para can never have status "open".
    // audit_observations.status DOES include "open" (its default state),
    // which is what this metric is meant to represent.
    const [openObs] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(auditObservations)
      .where(and(eq(auditObservations.tenantId, tenantId), eq(auditObservations.status, "open")));

    const [openParas] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(auditParas)
      .where(and(eq(auditParas.tenantId, tenantId), eq(auditParas.status, "issued")));

    const [openRisks] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(auditRisks)
      .where(and(eq(auditRisks.tenantId, tenantId), eq(auditRisks.status, "open")));

    return { openObs, openParas, openRisks };
  });

  return {
    openObservations: openObs?.count ?? 0,
    riskRegisterItems: openRisks?.count ?? 0,
    cagParas: openParas?.count ?? 0,
    compliancePct: 0,
  };
}
