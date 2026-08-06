/**
 * Onboarding health metric queries — cache-through reads (G19).
 */
import { cache } from "../../shared/infra.js";
import * as repo from "./repo.js";
import type { HealthRuleView, HealthScoreView } from "./schema.js";

export const RULES_RESOURCE = "onboarding_health_rule";
export const SCORES_RESOURCE = "onboarding_health_score";

export function ruleKeyFor(tenantId: string, id: string): string {
  return cache.makeKey(tenantId, RULES_RESOURCE, id);
}

export function scoreKeyFor(tenantId: string, caseId: string): string {
  return cache.makeKey(tenantId, SCORES_RESOURCE, caseId);
}

export async function getHealthRule(id: string, tenantId: string): Promise<HealthRuleView | null> {
  return cache.getOrLoad<HealthRuleView>(ruleKeyFor(tenantId, id), () => repo.findRuleById(id, tenantId));
}

export async function listHealthRules(
  tenantId: string,
  limit: number,
  offset: number,
): Promise<{ rows: HealthRuleView[]; total: number }> {
  const variant = `${limit}:${offset}`;
  return cache.listOrLoad(
    tenantId,
    RULES_RESOURCE,
    variant,
    () => repo.listRulesByTenant(tenantId, limit, offset),
  );
}

export async function getHealthScore(caseId: string, tenantId: string): Promise<HealthScoreView | null> {
  return cache.getOrLoad<HealthScoreView>(scoreKeyFor(tenantId, caseId), () => repo.findScoreByCaseId(caseId, tenantId));
}

export async function invalidateHealthRules(tenantId: string): Promise<void> {
  await cache.invalidateResource(tenantId, RULES_RESOURCE);
}

export async function invalidateHealthScore(tenantId: string, caseId: string): Promise<void> {
  await cache.invalidate(scoreKeyFor(tenantId, caseId));
  await cache.invalidateResource(tenantId, SCORES_RESOURCE);
}
