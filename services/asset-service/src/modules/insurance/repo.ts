import { eq, and } from "drizzle-orm";
import { db, scopedRead } from "../../shared/db.js";
import { assetPolicies, assetClaims, type PolicyInsert, type ClaimInsert, type PolicyRow } from "./schema.js";

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
