/**
 * Onboarding health metric repository (G19).
 *
 * DB reads for health rules and scores. Write operations live in the consumer.
 */
import { and, desc, eq, sql } from "drizzle-orm";
import { scopedRead } from "../../shared/db.js";
import {
  onboardingHealthRules,
  onboardingHealthScores,
  type HealthRuleRow,
  type HealthRuleView,
  type HealthScoreRow,
  type HealthScoreView,
  type MilestoneResult,
} from "./schema.js";

export function ruleToView(r: HealthRuleRow): HealthRuleView {
  return {
    id: r.id,
    tenantId: r.tenantId,
    ruleKey: r.ruleKey,
    milestoneEvent: r.milestoneEvent,
    expectedWithinDays: r.expectedWithinDays,
    weight: r.weight,
    active: r.active,
    version: r.version,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

export function scoreToView(r: HealthScoreRow): HealthScoreView {
  return {
    id: r.id,
    tenantId: r.tenantId,
    caseId: r.caseId,
    score: r.score,
    milestonesHit: r.milestonesHit as MilestoneResult[],
    computedAt: r.computedAt.toISOString(),
    version: r.version,
  };
}

export async function findRuleById(id: string, tenantId: string): Promise<HealthRuleView | null> {
  const rows = await scopedRead((tx) =>
    tx.select().from(onboardingHealthRules)
      .where(and(eq(onboardingHealthRules.id, id), eq(onboardingHealthRules.tenantId, tenantId)))
      .limit(1),
  );
  const row = rows[0];
  return row ? ruleToView(row) : null;
}

export async function listRulesByTenant(
  tenantId: string,
  limit: number,
  offset: number,
): Promise<{ rows: HealthRuleView[]; total: number }> {
  return scopedRead(async (tx) => {
    const where = eq(onboardingHealthRules.tenantId, tenantId);
    const rows = await tx.select().from(onboardingHealthRules)
      .where(where)
      .orderBy(desc(onboardingHealthRules.updatedAt))
      .limit(limit)
      .offset(offset);
    const counted = await tx.select({ total: sql<number>`count(*)::int` })
      .from(onboardingHealthRules)
      .where(where);
    return { rows: rows.map(ruleToView), total: (counted[0] as { total: number })?.total ?? 0 };
  });
}

export async function listActiveRulesByTenant(tenantId: string): Promise<HealthRuleView[]> {
  const rows = await scopedRead((tx) =>
    tx.select().from(onboardingHealthRules)
      .where(and(eq(onboardingHealthRules.tenantId, tenantId), eq(onboardingHealthRules.active, true)))
      .orderBy(onboardingHealthRules.ruleKey),
  );
  return rows.map(ruleToView);
}

export async function findScoreByCaseId(caseId: string, tenantId: string): Promise<HealthScoreView | null> {
  const rows = await scopedRead((tx) =>
    tx.select().from(onboardingHealthScores)
      .where(and(eq(onboardingHealthScores.caseId, caseId), eq(onboardingHealthScores.tenantId, tenantId)))
      .limit(1),
  );
  const row = rows[0];
  return row ? scoreToView(row) : null;
}
