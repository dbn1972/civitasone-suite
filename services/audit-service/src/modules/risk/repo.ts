import { and, eq, desc, gte, inArray, sql } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { auditRisks, auditPlanRisks, type RiskRow, type RiskInsert, type PlanRiskRow } from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export async function findById(id: string, tenantId: string): Promise<RiskRow | null> {
  // Wrapped in db.transaction() so wrapWithTenantGuc injects app.tenant_id
  // before this read — a bare db.select() runs with no RLS GUC set.
  const rows = await db.transaction((tx) => tx.select().from(auditRisks).where(and(eq(auditRisks.id, id), eq(auditRisks.tenantId, tenantId))).limit(1));
  return rows[0] ?? null;
}

export async function findByIdTx(tx: Writer, id: string, tenantId: string): Promise<RiskRow | null> {
  const rows = await (tx as typeof db).select().from(auditRisks).where(and(eq(auditRisks.id, id), eq(auditRisks.tenantId, tenantId))).limit(1);
  return rows[0] ?? null;
}

export async function listByTenant(tenantId: string, limit: number): Promise<RiskRow[]> {
  // Wrapped in db.transaction() so wrapWithTenantGuc injects app.tenant_id
  // before this read — a bare db.select() runs with no RLS GUC set.
  return db.transaction((tx) => tx.select().from(auditRisks)
    .where(eq(auditRisks.tenantId, tenantId))
    .orderBy(desc(auditRisks.riskScore), desc(auditRisks.createdAt))
    .limit(limit));
}

/** P1-7: audit-universe — open risks at or above a score threshold, highest first. */
export async function listHighRisk(tenantId: string, threshold: number, limit: number): Promise<RiskRow[]> {
  // Wrapped in db.transaction() so wrapWithTenantGuc injects app.tenant_id
  // before this read — a bare db.select() runs with no RLS GUC set.
  return db.transaction((tx) => tx.select().from(auditRisks)
    .where(and(
      eq(auditRisks.tenantId, tenantId),
      eq(auditRisks.status, "open"),
      gte(auditRisks.riskScore, threshold),
    ))
    .orderBy(desc(auditRisks.riskScore), desc(auditRisks.createdAt))
    .limit(limit));
}

export async function insertRisk(tx: Writer, row: RiskInsert): Promise<void> {
  await tx.insert(auditRisks).values(row);
}

/** Optimistic-locked, tenant-scoped update. Returns rows affected (0 = stale version / not found). */
export async function updateRiskVersioned(tx: Writer, id: string, tenantId: string, expectedVersion: number, patch: Partial<RiskInsert>): Promise<number> {
  const res = await tx.update(auditRisks)
    .set({ ...patch, updatedAt: new Date() })
    .where(and(eq(auditRisks.id, id), eq(auditRisks.tenantId, tenantId), eq(auditRisks.version, expectedVersion)))
    .returning({ id: auditRisks.id });
  return res.length;
}

// --- P1-7: plan <-> risk linkage (audit universe) ---

/** Returns the subset of riskIds that exist for this tenant (cross-tenant ids are dropped). */
export async function selectExistingRiskIds(tx: Writer, tenantId: string, riskIds: string[]): Promise<string[]> {
  if (riskIds.length === 0) return [];
  const rows = await (tx as typeof db).select({ id: auditRisks.id }).from(auditRisks)
    .where(and(eq(auditRisks.tenantId, tenantId), inArray(auditRisks.id, riskIds)));
  return rows.map((r) => r.id);
}

/** Idempotent link insert (dedupes on (plan_id, risk_id) via the unique index). */
export async function linkRisksToPlan(tx: Writer, tenantId: string, planId: string, riskIds: string[], createdBy: string): Promise<number> {
  if (riskIds.length === 0) return 0;
  const res = await tx.insert(auditPlanRisks)
    .values(riskIds.map((riskId) => ({ tenantId, planId, riskId, createdBy })))
    .onConflictDoNothing()
    .returning({ id: auditPlanRisks.id });
  return res.length;
}

export async function listRisksForPlan(tenantId: string, planId: string, limit = 500): Promise<RiskRow[]> {
  // Wrapped in db.transaction() so wrapWithTenantGuc injects app.tenant_id
  // before this read — a bare db.select() runs with no RLS GUC set.
  return db.transaction((tx) => tx.select({
      id: auditRisks.id, tenantId: auditRisks.tenantId, riskCode: auditRisks.riskCode,
      title: auditRisks.title, category: auditRisks.category, likelihood: auditRisks.likelihood,
      impact: auditRisks.impact, riskScore: auditRisks.riskScore, ownerRef: auditRisks.ownerRef,
      mitigationStatus: auditRisks.mitigationStatus, reviewDate: auditRisks.reviewDate,
      status: auditRisks.status, createdAt: auditRisks.createdAt, updatedAt: auditRisks.updatedAt,
      createdBy: auditRisks.createdBy, updatedBy: auditRisks.updatedBy, version: auditRisks.version,
    })
    .from(auditPlanRisks)
    .innerJoin(auditRisks, eq(auditRisks.id, auditPlanRisks.riskId))
    .where(and(eq(auditPlanRisks.tenantId, tenantId), eq(auditPlanRisks.planId, planId)))
    .orderBy(desc(auditRisks.riskScore))
    .limit(limit));
}

export async function countLinksForPlan(tenantId: string, planId: string): Promise<number> {
  // Wrapped in db.transaction() so wrapWithTenantGuc injects app.tenant_id
  // before this read — a bare db.select() runs with no RLS GUC set.
  const rows = await db.transaction((tx) => tx.select({ count: sql<number>`count(*)::int` }).from(auditPlanRisks)
    .where(and(eq(auditPlanRisks.tenantId, tenantId), eq(auditPlanRisks.planId, planId))));
  return rows[0]?.count ?? 0;
}

export type { PlanRiskRow };
