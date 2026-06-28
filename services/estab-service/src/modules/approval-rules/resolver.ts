import { cache } from "../../shared/infra.js";
import * as repo from "./repo.js";
import type { ApprovalRuleRow } from "./schema.js";

export type ResolvedApproval = {
  ruleId: string;
  label: string;
  workflowDefinitionCode: string;
  startNodeKey: string;
  steps: Array<{ role: string; label: string }>;
};

/** Does an amount (minor units) fall within a rule's band? */
function inBand(rule: ApprovalRuleRow, amountMinor: number): boolean {
  if (amountMinor < rule.minAmountMinor) return false;
  if (rule.maxAmountMinor !== null && amountMinor >= rule.maxAmountMinor) return false;
  return true;
}

/**
 * Resolve the approval chain for a (tenant, sourceType, amount).
 * Picks the matching band; on overlap, the highest min (most specific) then
 * lowest priority wins. Returns null when no rule matches (caller falls back
 * to the explicitly supplied approval chain).
 */
export async function resolveApproval(
  tenantId: string,
  sourceType: string,
  amountMinor: number,
): Promise<ResolvedApproval | null> {
  const rules = await cache.getOrLoad<ApprovalRuleRow[]>(
    cache.makeKey(tenantId, "approval_rules", sourceType),
    () => repo.listActiveRulesForSource(tenantId, sourceType),
    60,
  ) ?? [];

  const matches = rules.filter((r) => inBand(r, amountMinor));
  if (matches.length === 0) return null;

  // Most specific band first (highest min), then lowest priority number.
  matches.sort((a, b) => (b.minAmountMinor - a.minAmountMinor) || (a.priority - b.priority));
  const best = matches[0];
  if (!best) return null;

  return {
    ruleId: best.id,
    label: best.label,
    workflowDefinitionCode: best.workflowDefinitionCode,
    startNodeKey: best.startNodeKey,
    steps: Array.isArray(best.steps) ? (best.steps as Array<{ role: string; label: string }>) : [],
  };
}

/** Invalidate the resolver cache for a source type (call after rule writes). */
export async function invalidateResolverCache(tenantId: string, sourceType: string): Promise<void> {
  await cache.invalidate(cache.makeKey(tenantId, "approval_rules", sourceType));
}
