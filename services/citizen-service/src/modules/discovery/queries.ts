import * as repo from "./repo.js";

export async function getConsent(tenantId: string, citizenId: string, scope = "benefit_discovery") {
  return repo.findActiveConsent(tenantId, citizenId, scope);
}

export async function listMatches(tenantId: string, citizenId: string) {
  return repo.listMatchesByCitizen(tenantId, citizenId);
}
