import { cache } from "../../shared/infra.js";
import { RESOURCE } from "../../topics.js";
import * as repo from "./repo.js";
import type { AlertRuleView } from "./domain.js";

export async function listAlertRules(tenantId: string): Promise<AlertRuleView[]> {
  return cache.getOrLoad<AlertRuleView[]>(
    cache.makeKey(tenantId, RESOURCE.alertRule, "list"),
    () => repo.findRulesByTenant(tenantId),
  ) as Promise<AlertRuleView[]>;
}

export async function getAlertRule(tenantId: string, id: string): Promise<AlertRuleView | null> {
  return cache.getOrLoad<AlertRuleView>(
    cache.makeKey(tenantId, RESOURCE.alertRule, id),
    () => repo.findRuleById(id),
  );
}
