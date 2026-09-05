import { eq } from "drizzle-orm";
import { db, scopedRead } from "../../shared/db.js";
import { billingSubscriptions, billingTrials, type BillingSubscriptionInsert, type BillingTrialInsert } from "./schema.js";
import type { SubscriptionView } from "./domain.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export async function findByTenant(tenantId: string): Promise<SubscriptionView | null> {
  const rows = await scopedRead((tx) => tx.select().from(billingSubscriptions).where(eq(billingSubscriptions.tenantId, tenantId)).limit(1));
  const sub = rows[0];
  if (!sub) return null;
  const trials = await scopedRead((tx) => tx.select().from(billingTrials).where(eq(billingTrials.subscriptionId, sub.id)).limit(1));
  const view: SubscriptionView = {
    id: sub.id, tenantId: sub.tenantId, planId: sub.planId, status: sub.status,
  };
  if (trials[0]?.expiresAt) view.trialExpiresAt = trials[0].expiresAt.toISOString();
  return view;
}

/**
 * Tx-scoped variant of findByTenant: reads through the caller'''s already-open
 * transaction instead of opening up to TWO nested ones via scopedRead (this
 * function makes two separate scopedRead calls -- subscription then trial --
 * each of which opens its own db.transaction()). The Razorpay checkout-verify
 * and payment-captured webhook handlers call this from inside their own open
 * db.transaction() -- calling the scopedRead-based version there competes for
 * connections from the same pool as the outer one, deadlocking every
 * in-flight payment-processing command once concurrency reaches pool.max
 * (see .claude/skills/16-production-readiness-audit.md section 1).
 */
export async function findByTenantTx(tx: Writer, tenantId: string): Promise<SubscriptionView | null> {
  const rows = await (tx as typeof db).select().from(billingSubscriptions).where(eq(billingSubscriptions.tenantId, tenantId)).limit(1);
  const sub = rows[0];
  if (!sub) return null;
  const trials = await (tx as typeof db).select().from(billingTrials).where(eq(billingTrials.subscriptionId, sub.id)).limit(1);
  const view: SubscriptionView = {
    id: sub.id, tenantId: sub.tenantId, planId: sub.planId, status: sub.status,
  };
  if (trials[0]?.expiresAt) view.trialExpiresAt = trials[0].expiresAt.toISOString();
  return view;
}

export async function insertSub(tx: Writer, row: BillingSubscriptionInsert): Promise<void> {
  await tx.insert(billingSubscriptions).values(row);
}

export async function insertTrial(tx: Writer, row: BillingTrialInsert): Promise<void> {
  await tx.insert(billingTrials).values(row);
}

export async function updateStatus(tx: Writer, id: string, status: string, actorId: string): Promise<void> {
  await tx.update(billingSubscriptions).set({ status, updatedBy: actorId, updatedAt: new Date() }).where(eq(billingSubscriptions.id, id));
}

export async function findByIdTx(tx: Writer, id: string) {
  const rows = await tx.select().from(billingSubscriptions).where(eq(billingSubscriptions.id, id)).limit(1);
  return rows[0] ?? null;
}
