import * as repo from "./repo.js";
import type { PolicyRow, ClaimRow } from "./schema.js";

export async function getPolicy(tenantId: string, id: string): Promise<PolicyRow | null> {
  return repo.findPolicyById(id, tenantId);
}

export async function listPolicies(tenantId: string, opts?: { assetId?: string; status?: string; limit?: number; offset?: number }): Promise<PolicyRow[]> {
  return repo.findPoliciesByTenant(tenantId, opts);
}

export async function getClaim(tenantId: string, id: string): Promise<ClaimRow | null> {
  return repo.findClaimById(id, tenantId);
}

export async function listClaims(tenantId: string, opts?: { policyId?: string; status?: string; limit?: number; offset?: number }): Promise<ClaimRow[]> {
  return repo.findClaimsByTenant(tenantId, opts);
}
