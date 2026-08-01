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

/**
 * Cumulative claims already recorded against a policy — every claim EXCEPT
 * ones in a rejected/void state (a rejected claim never drew down the sum
 * insured). Used to enforce sum-insured across the *lifetime* of the policy,
 * not just against a single incoming claim (a policy with coverage 10,000
 * must not accept a 9,000 claim followed by another 9,000 claim).
 *
 * Pulls a high limit since this must see every claim ever filed against the
 * policy to be a correct running total, not just the first page.
 */
export async function sumClaimsByPolicy(tenantId: string, policyId: string): Promise<bigint> {
  const claims = await repo.findClaimsByTenant(tenantId, { policyId, limit: 100000, offset: 0 });
  return claims.reduce((total, c) => {
    if (c.status === "rejected") return total;
    return total + BigInt(c.claimAmountMinor);
  }, 0n);
}
