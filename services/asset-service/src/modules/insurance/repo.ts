import { eq, and, SQL } from "drizzle-orm";
import { db, scopedRead } from "../../shared/db.js";
import { assetPolicies, assetClaims, type PolicyInsert, type ClaimInsert, type PolicyRow, type ClaimRow } from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export async function insertPolicy(tx: Writer, row: PolicyInsert): Promise<void> {
  await tx.insert(assetPolicies).values(row);
}

export async function insertClaim(tx: Writer, row: ClaimInsert): Promise<void> {
  await tx.insert(assetClaims).values(row);
}

export async function findPolicyById(id: string, tenantId: string): Promise<PolicyRow | null> {
  // scopedRead() so wrapWithTenantGuc injects app.tenant_id before this
  // read — a bare db.select() runs with no RLS GUC set.
  const rows = await scopedRead((tx) => tx.select().from(assetPolicies).where(and(eq(assetPolicies.id, id), eq(assetPolicies.tenantId, tenantId))).limit(1));
  return rows[0] ?? null;
}

export async function findPoliciesByTenant(tenantId: string, opts?: { assetId?: string; status?: string; limit?: number; offset?: number }): Promise<PolicyRow[]> {
  const conditions: SQL[] = [eq(assetPolicies.tenantId, tenantId)];
  if (opts?.assetId) conditions.push(eq(assetPolicies.assetId, opts.assetId));
  if (opts?.status)  conditions.push(eq(assetPolicies.status, opts.status));
  // scopedRead() so wrapWithTenantGuc injects app.tenant_id before this
  // read — a bare db.select() runs with no RLS GUC set.
  return scopedRead((tx) => tx.select().from(assetPolicies)
    .where(and(...conditions))
    .limit(opts?.limit ?? 50)
    .offset(opts?.offset ?? 0));
}

export async function findClaimById(id: string, tenantId: string): Promise<ClaimRow | null> {
  const rows = await scopedRead((tx) => tx.select().from(assetClaims).where(and(eq(assetClaims.id, id), eq(assetClaims.tenantId, tenantId))).limit(1));
  return rows[0] ?? null;
}

export async function findClaimsByTenant(tenantId: string, opts?: { policyId?: string; status?: string; limit?: number; offset?: number }): Promise<ClaimRow[]> {
  const conditions: SQL[] = [eq(assetClaims.tenantId, tenantId)];
  if (opts?.policyId) conditions.push(eq(assetClaims.policyId, opts.policyId));
  if (opts?.status)   conditions.push(eq(assetClaims.status, opts.status));
  // scopedRead() so wrapWithTenantGuc injects app.tenant_id before this
  // read — a bare db.select() runs with no RLS GUC set.
  return scopedRead((tx) => tx.select().from(assetClaims)
    .where(and(...conditions))
    .limit(opts?.limit ?? 50)
    .offset(opts?.offset ?? 0));
}
