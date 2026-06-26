import { cache } from "../../shared/infra.js";
import { RESOURCE } from "../../topics.js";
import * as repo from "./repo.js";
import type { RuleView } from "./repo.js";
import { evaluate, type AccessRequest, type Decision } from "./domain.js";

export async function getRule(tenantId: string, id: string): Promise<RuleView | null> {
  return cache.getOrLoad<RuleView>(
    cache.makeKey(tenantId, RESOURCE.abacRule, id),
    () => repo.findRuleById(tenantId, id),
  );
}

export async function listRules(tenantId: string): Promise<RuleView[]> {
  return cache.getOrLoad<RuleView[]>(
    cache.makeKey(tenantId, `${RESOURCE.abacRule}_list`, tenantId),
    () => repo.findRulesByTenant(tenantId),
  ) as Promise<RuleView[]>;
}

// Decision query: load tenant rules and run the pure engine.
export async function evaluateAccess(tenantId: string, req: AccessRequest): Promise<Decision> {
  const rules = await repo.loadCompiledRules(tenantId);
  return evaluate(rules, req);
}
