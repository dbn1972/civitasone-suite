import * as repo from "./repo.js";

export async function listRuleSets(tenantId: string) {
  return repo.listRuleSets(tenantId);
}

export async function getRuleSet(tenantId: string, id: string) {
  return repo.findRuleSetById(id, tenantId);
}

export async function getEvaluation(tenantId: string, id: string) {
  return repo.findEvaluationById(id, tenantId);
}

export async function listManualReviewQueue(tenantId: string) {
  return repo.listManualReviewQueue(tenantId);
}
