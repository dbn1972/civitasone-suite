import { eq, and, inArray, sql, SQL } from "drizzle-orm";
import { db, scopedRead } from "../../shared/db.js";
import { enqueue, type DrizzleTx } from "../../shared/outbox.js";
import { assetPolicies, assetClaims, type PolicyInsert, type ClaimInsert, type PolicyRow, type ClaimRow } from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export async function insertPolicy(tx: Writer, row: PolicyInsert): Promise<void> {
  await tx.insert(assetPolicies).values(row);
}

export async function insertClaim(tx: Writer, row: ClaimInsert): Promise<void> {
  await tx.insert(assetClaims).values(row);
}

/**
 * Tenant-scoped, CONDITIONAL updates. They run inside db.transaction so the
 * tenant GUC is set (a bare db.update() matches zero rows under the
 * NOBYPASSRLS role yet reports success), and they return the changed row or
 * null so a stale/duplicate decision is detected instead of silently
 * succeeding. The audit event is enqueued in the SAME transaction.
 */
export type DecisionAudit = {
  actorId: string;
  correlationId: string;
  action: string;
  resourceType: "insurance_claim" | "insurance_policy";
  before: { status: string; amountMinor: bigint };
  reason?: string | undefined;
};

async function auditDecision(tx: Parameters<typeof enqueue>[0], tenantId: string, id: string, a: DecisionAudit, after: { status: string; amountMinor: bigint }) {
  await enqueue(tx, {
    topic: "audit.event.record", eventType: "audit.event.record",
    tenantId, actorId: a.actorId, correlationId: a.correlationId,
    payload: {
      service: "asset", action: a.action, resourceType: a.resourceType, resourceId: id, outcome: "success",
      before: { status: a.before.status, amountMinor: a.before.amountMinor.toString() },
      after: { status: after.status, amountMinor: after.amountMinor.toString() },
      ...(a.reason ? { reason: a.reason } : {}),
    },
  });
}

/** Returns the updated claim, or null when it is no longer in one of `fromStatuses`. */
export async function updateClaim(
  tenantId: string, id: string, patch: Partial<ClaimInsert>, fromStatuses: string[], audit: DecisionAudit,
  appendNote?: string,
): Promise<ClaimRow | null> {
  return db.transaction(async (tx) => updateClaimTx(tx, tenantId, id, patch, fromStatuses, audit, appendNote));
}

/**
 * Tx-scoped variant of updateClaim — runs inside the caller's already-open
 * consumer transaction (GAP2-ASSETS-INSURANCE-CLAIMS-02 CQRS path). The
 * conditional UPDATE + audit enqueue share that one transaction.
 */
export async function updateClaimTx(
  tx: DrizzleTx,
  tenantId: string, id: string, patch: Partial<ClaimInsert>, fromStatuses: string[], audit: DecisionAudit,
  appendNote?: string,
): Promise<ClaimRow | null> {
  const set: Record<string, unknown> = { ...patch };
  // Rejecting must not overwrite the filer's notes: append, atomically.
  if (appendNote) set.notes = sql`CASE WHEN ${assetClaims.notes} IS NULL OR ${assetClaims.notes} = '' THEN ${appendNote} ELSE ${assetClaims.notes} || E'\n' || ${appendNote} END`;
  const rows = await tx.update(assetClaims).set(set)
    .where(and(eq(assetClaims.id, id), eq(assetClaims.tenantId, tenantId), inArray(assetClaims.status, fromStatuses)))
    .returning();
  const row = rows[0];
  if (!row) return null;
  await auditDecision(tx, tenantId, id, audit, { status: row.status, amountMinor: row.settledAmountMinor });
  return row;
}

/** Tx-scoped read of a claim (for the consumer's SoD / status re-assert). */
export async function findClaimByIdTx(tx: Writer, id: string, tenantId: string): Promise<ClaimRow | null> {
  const rows = await tx.select().from(assetClaims).where(and(eq(assetClaims.id, id), eq(assetClaims.tenantId, tenantId))).limit(1);
  return rows[0] ?? null;
}

/** Tx-scoped read of a policy (for the consumer's update path). */
export async function findPolicyByIdTx(tx: Writer, id: string, tenantId: string): Promise<PolicyRow | null> {
  const rows = await tx.select().from(assetPolicies).where(and(eq(assetPolicies.id, id), eq(assetPolicies.tenantId, tenantId))).limit(1);
  return rows[0] ?? null;
}

/** Returns the updated policy, or null when no row matched (missing / other tenant). */
export async function updatePolicy(
  tenantId: string, id: string, patch: Partial<PolicyInsert>, audit: DecisionAudit,
): Promise<PolicyRow | null> {
  return db.transaction(async (tx) => updatePolicyTx(tx, tenantId, id, patch, audit));
}

/** Tx-scoped variant of updatePolicy — see updateClaimTx. */
export async function updatePolicyTx(
  tx: DrizzleTx,
  tenantId: string, id: string, patch: Partial<PolicyInsert>, audit: DecisionAudit,
): Promise<PolicyRow | null> {
  const rows = await tx.update(assetPolicies).set(patch)
    .where(and(eq(assetPolicies.id, id), eq(assetPolicies.tenantId, tenantId)))
    .returning();
  const row = rows[0];
  if (!row) return null;
  await auditDecision(tx, tenantId, id, audit, { status: row.status, amountMinor: row.premiumMinor });
  return row;
}

export type ClaimInsertT = ClaimInsert;
export type PolicyInsertT = PolicyInsert;

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
