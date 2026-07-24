import { eq, and, desc } from "drizzle-orm";
import { db } from "../../shared/db.js";
import {
  eligibilityRuleSets, eligibilityEvaluations,
  type RuleSetRow, type RuleSetInsert, type EvaluationRow, type EvaluationInsert,
} from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export async function insertRuleSet(tx: Writer, row: RuleSetInsert): Promise<void> {
  await tx.insert(eligibilityRuleSets).values(row);
}

export async function findRuleSetByIdTx(tx: Writer, id: string, tenantId: string): Promise<RuleSetRow | null> {
  const rows = await (tx as typeof db).select().from(eligibilityRuleSets)
    .where(and(eq(eligibilityRuleSets.id, id), eq(eligibilityRuleSets.tenantId, tenantId))).limit(1);
  return rows[0] ?? null;
}

export async function findRuleSetById(id: string, tenantId: string): Promise<RuleSetRow | null> {
  return db.transaction((tx) => findRuleSetByIdTx(tx, id, tenantId));
}

/** Latest version number for a (tenant, service) or 0 when none exist. */
export async function latestVersionForService(tx: Writer, tenantId: string, serviceId: string): Promise<number> {
  const rows = await (tx as typeof db).select().from(eligibilityRuleSets)
    .where(and(eq(eligibilityRuleSets.tenantId, tenantId), eq(eligibilityRuleSets.serviceId, serviceId)))
    .orderBy(desc(eligibilityRuleSets.version)).limit(1);
  return rows[0]?.version ?? 0;
}

export async function updateRuleSet(tx: Writer, id: string, tenantId: string, patch: Partial<RuleSetInsert>): Promise<void> {
  await tx.update(eligibilityRuleSets).set({ ...patch, updatedAt: new Date() })
    .where(and(eq(eligibilityRuleSets.id, id), eq(eligibilityRuleSets.tenantId, tenantId)));
}

export async function listRuleSets(tenantId: string, limit = 200): Promise<RuleSetRow[]> {
  return db.transaction((tx) => tx.select().from(eligibilityRuleSets)
    .where(eq(eligibilityRuleSets.tenantId, tenantId))
    .orderBy(desc(eligibilityRuleSets.createdAt)).limit(limit));
}

/** Latest PUBLISHED rule set for a service (used by evaluate + discovery). */
export async function findPublishedRuleSet(tx: Writer, tenantId: string, serviceId: string): Promise<RuleSetRow | null> {
  const rows = await (tx as typeof db).select().from(eligibilityRuleSets)
    .where(and(
      eq(eligibilityRuleSets.tenantId, tenantId),
      eq(eligibilityRuleSets.serviceId, serviceId),
      eq(eligibilityRuleSets.status, "published"),
    ))
    .orderBy(desc(eligibilityRuleSets.version)).limit(1);
  return rows[0] ?? null;
}

export async function insertEvaluation(tx: Writer, row: EvaluationInsert): Promise<void> {
  await tx.insert(eligibilityEvaluations).values(row);
}

export async function findEvaluationByIdTx(tx: Writer, id: string, tenantId: string): Promise<EvaluationRow | null> {
  const rows = await (tx as typeof db).select().from(eligibilityEvaluations)
    .where(and(eq(eligibilityEvaluations.id, id), eq(eligibilityEvaluations.tenantId, tenantId))).limit(1);
  return rows[0] ?? null;
}

export async function findEvaluationById(id: string, tenantId: string): Promise<EvaluationRow | null> {
  return db.transaction((tx) => findEvaluationByIdTx(tx, id, tenantId));
}

export async function updateEvaluation(tx: Writer, id: string, tenantId: string, patch: Partial<EvaluationInsert>): Promise<void> {
  await tx.update(eligibilityEvaluations).set({ ...patch, updatedAt: new Date() })
    .where(and(eq(eligibilityEvaluations.id, id), eq(eligibilityEvaluations.tenantId, tenantId)));
}

export async function listManualReviewQueue(tenantId: string, limit = 200): Promise<EvaluationRow[]> {
  return db.transaction((tx) => tx.select().from(eligibilityEvaluations)
    .where(and(eq(eligibilityEvaluations.tenantId, tenantId), eq(eligibilityEvaluations.reviewStatus, "pending")))
    .orderBy(desc(eligibilityEvaluations.createdAt)).limit(limit));
}
