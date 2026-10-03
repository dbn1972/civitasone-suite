import { and, asc, desc, eq, inArray, lte, ne, sql } from "drizzle-orm";
import { scopedPlatformRead } from "../../shared/db.js";
import {
  adminTenants,
  tenantLifecycleRequests as R,
  tenantLifecycleApprovals as A,
  type LifecycleRequestInsert,
  type LifecycleRequestRow,
} from "./schema.js";
import type { Writer } from "./repo.js";
import type { ApprovalPolicy } from "./lifecycle-domain.js";

type Tx = Writer & Pick<import("../../shared/db.js").Db, "delete">;

export async function insertRequest(tx: Tx, row: LifecycleRequestInsert): Promise<void> {
  await tx.insert(R).values(row);
}

export async function findRequestTx(tx: Tx, tenantId: string, id: string): Promise<LifecycleRequestRow | null> {
  const rows = await tx.select().from(R).where(and(eq(R.id, id), eq(R.tenantId, tenantId))).limit(1);
  return rows[0] ?? null;
}

/**
 * Race-safe decision #1: reject. Succeeds for exactly one caller, and only
 * while the request is still pending and the decider is not the requester.
 */
export async function rejectConditional(
  tx: Tx, tenantId: string, id: string, actorId: string, comment: string | null,
): Promise<LifecycleRequestRow | null> {
  const rows = await tx.update(R).set({
    status: "rejected", decidedBy: actorId, decidedAt: new Date(), decisionReason: comment, version: sql`${R.version} + 1`,
  }).where(and(eq(R.id, id), eq(R.tenantId, tenantId), eq(R.status, "pending"), ne(R.requestedBy, actorId))).returning();
  return rows[0] ?? null;
}

/**
 * Race-safe decision #2: one more approval. The single conditional UPDATE
 * bumps the counter and, when this approval reaches `required_approvals`,
 * moves the request out of 'pending' (to 'scheduled' when it has a future
 * effective time, else 'executed' -- the caller then runs the action inside
 * the same transaction). Two approvers racing: the second blocks on the row
 * lock, re-evaluates `status = 'pending'` after the first commits, matches no
 * row and gets null -- so the action runs exactly once.
 */
export async function approveConditional(
  tx: Tx, tenantId: string, id: string, actorId: string, comment: string | null,
): Promise<LifecycleRequestRow | null> {
  const rows = await tx.update(R).set({
    approvalsCount: sql`${R.approvalsCount} + 1`,
    status: sql`CASE WHEN ${R.approvalsCount} + 1 >= ${R.requiredApprovals}
      THEN (CASE WHEN ${R.effectiveAt} IS NOT NULL AND ${R.effectiveAt} > now() THEN 'scheduled' ELSE 'executed' END)
      ELSE 'pending' END`,
    // decided_* describe the decision that moved the request OUT of pending;
    // a partial approval (minApprovals > 1) leaves them untouched.
    decidedBy: sql`CASE WHEN ${R.approvalsCount} + 1 >= ${R.requiredApprovals} THEN ${actorId}::uuid ELSE ${R.decidedBy} END`,
    decidedAt: sql`CASE WHEN ${R.approvalsCount} + 1 >= ${R.requiredApprovals} THEN now() ELSE ${R.decidedAt} END`,
    decisionReason: sql`CASE WHEN ${R.approvalsCount} + 1 >= ${R.requiredApprovals} THEN ${comment}::text ELSE ${R.decisionReason} END`,
    version: sql`${R.version} + 1`,
  }).where(and(eq(R.id, id), eq(R.tenantId, tenantId), eq(R.status, "pending"), ne(R.requestedBy, actorId))).returning();
  return rows[0] ?? null;
}

/** Records an approver's vote; false when this approver already voted. */
export async function insertApproval(
  tx: Tx, row: { tenantId: string; requestId: string; approverId: string; approverRoles: string[]; comment: string | null },
): Promise<string | null> {
  const rows = await tx.insert(A).values(row).onConflictDoNothing().returning({ id: A.id });
  return rows[0]?.id ?? null;
}

export async function deleteApproval(tx: Tx, tenantId: string, id: string): Promise<void> {
  await tx.delete(A).where(and(eq(A.id, id), eq(A.tenantId, tenantId)));
}

export async function markExecuted(tx: Tx, tenantId: string, id: string): Promise<void> {
  await tx.update(R).set({ executedAt: new Date() }).where(and(eq(R.id, id), eq(R.tenantId, tenantId)));
}

/** Race-safe cancel: succeeds only while the request is still 'scheduled'; loses cleanly to the due-sweep's claim. */
export async function cancelScheduled(
  tx: Tx, tenantId: string, id: string, actorId: string, reason: string,
): Promise<LifecycleRequestRow | null> {
  const rows = await tx.update(R).set({
    status: "cancelled", cancelledBy: actorId, cancelledAt: new Date(), cancelReason: reason, version: sql`${R.version} + 1`,
  }).where(and(eq(R.id, id), eq(R.tenantId, tenantId), eq(R.status, "scheduled"))).returning();
  return rows[0] ?? null;
}

export async function listApproverIdsTx(tx: Tx, tenantId: string, requestId: string): Promise<string[]> {
  const rows = await tx.select({ id: A.approverId }).from(A)
    .where(and(eq(A.tenantId, tenantId), eq(A.requestId, requestId))).orderBy(asc(A.createdAt), asc(A.id));
  return rows.map((r) => r.id);
}

export async function listApproverIds(tenantId: string, requestIds: string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (requestIds.length === 0) return out;
  const rows = await scopedPlatformRead((tx) => tx.select({ r: A.requestId, a: A.approverId }).from(A)
    .where(and(eq(A.tenantId, tenantId), inArray(A.requestId, requestIds))));
  for (const x of rows) out.set(x.r, [...(out.get(x.r) ?? []), x.a]);
  return out;
}

/** Scheduled -> executed, only when due; null for the loser of a race or a not-yet-due request. */
export async function claimDueScheduled(tx: Tx, tenantId: string, id: string): Promise<LifecycleRequestRow | null> {
  const rows = await tx.update(R).set({ status: "executed", executedAt: new Date(), version: sql`${R.version} + 1` })
    .where(and(eq(R.id, id), eq(R.tenantId, tenantId), eq(R.status, "scheduled"), lte(R.effectiveAt, sql`now()`))).returning();
  return rows[0] ?? null;
}

/** Failure after the action's own transaction rolled back: pending/scheduled -> failed. */
export async function markFailed(
  tx: Tx, tenantId: string, id: string, failureCode: string, actorId: string,
): Promise<boolean> {
  const rows = await tx.update(R).set({
    status: "failed", failureCode, decidedBy: actorId, decidedAt: new Date(), version: sql`${R.version} + 1`,
  }).where(and(eq(R.id, id), eq(R.tenantId, tenantId), inArray(R.status, ["pending", "scheduled", "executed"]))).returning({ id: R.id });
  return rows.length > 0;
}

/** Writes settings.approvalPolicy without touching any other settings key. */
export async function writePolicy(tx: Tx, tenantId: string, policy: ApprovalPolicy, actorId: string): Promise<void> {
  await tx.update(adminTenants).set({
    settings: sql`jsonb_set(coalesce(${adminTenants.settings}, '{}'::jsonb), '{approvalPolicy}', ${JSON.stringify(policy)}::jsonb, true)`,
    updatedBy: actorId,
    updatedAt: new Date(),
    version: sql`${adminTenants.version} + 1`,
  }).where(eq(adminTenants.id, tenantId));
}

// ── platform-wide reads (route layer has already required a platform role) ──

export async function listRequests(tenantId: string, status: string | undefined, limit: number): Promise<LifecycleRequestRow[]> {
  return scopedPlatformRead((tx) => tx.select().from(R)
    .where(status ? and(eq(R.tenantId, tenantId), eq(R.status, status)) : eq(R.tenantId, tenantId))
    .orderBy(desc(R.requestedAt), desc(R.id)).limit(limit));
}

export async function findRequest(tenantId: string, id: string): Promise<LifecycleRequestRow | null> {
  const rows = await scopedPlatformRead((tx) => tx.select().from(R).where(and(eq(R.id, id), eq(R.tenantId, tenantId))).limit(1));
  return rows[0] ?? null;
}

export async function findOpen(tenantId: string, kind: string): Promise<LifecycleRequestRow | null> {
  const rows = await scopedPlatformRead((tx) => tx.select().from(R)
    .where(and(eq(R.tenantId, tenantId), eq(R.kind, kind), inArray(R.status, ["pending", "scheduled"]))).limit(1));
  return rows[0] ?? null;
}

export async function listDue(limit: number): Promise<Array<{ id: string; tenantId: string; decidedBy: string | null; requestedBy: string }>> {
  return scopedPlatformRead((tx) => tx.select({ id: R.id, tenantId: R.tenantId, decidedBy: R.decidedBy, requestedBy: R.requestedBy })
    .from(R).where(and(eq(R.status, "scheduled"), lte(R.effectiveAt, sql`now()`))).orderBy(asc(R.effectiveAt)).limit(limit));
}
