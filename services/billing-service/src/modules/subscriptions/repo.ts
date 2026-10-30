import { and, desc, eq, sql } from "drizzle-orm";
import { db, scopedRead } from "../../shared/db.js";
import { billingSubscriptions, billingTrials, type BillingSubscriptionInsert, type BillingTrialInsert } from "./schema.js";
import type { SubscriptionView } from "./domain.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

// A tenant has at most one current (non-cancelled) subscription plus any number of cancelled past
// ones (migration 0025): "the subscription" is the current one, else the most recent past one.
const CURRENT_FIRST = sql`(${billingSubscriptions.status} = 'cancelled')`;

export async function findByTenant(tenantId: string): Promise<SubscriptionView | null> {
  const rows = await scopedRead((tx) => tx.select().from(billingSubscriptions).where(eq(billingSubscriptions.tenantId, tenantId)).orderBy(CURRENT_FIRST, desc(billingSubscriptions.startedAt)).limit(1));
  const sub = rows[0];
  if (!sub) return null;
  const trials = await scopedRead((tx) => tx.select().from(billingTrials).where(eq(billingTrials.subscriptionId, sub.id)).limit(1));
  const view: SubscriptionView = {
    id: sub.id, tenantId: sub.tenantId, planId: sub.planId, status: sub.status,
    startedAt: sub.startedAt.toISOString(), endsAt: sub.endsAt ? sub.endsAt.toISOString() : null,
  };
  if (trials[0]?.expiresAt) view.trialExpiresAt = trials[0].expiresAt.toISOString();
  return view;
}

/**
 * Tx-scoped variant of findByTenant: reads through the caller's already-open
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
  const rows = await (tx as typeof db).select().from(billingSubscriptions).where(eq(billingSubscriptions.tenantId, tenantId)).orderBy(CURRENT_FIRST, desc(billingSubscriptions.startedAt)).limit(1);
  const sub = rows[0];
  if (!sub) return null;
  const trials = await (tx as typeof db).select().from(billingTrials).where(eq(billingTrials.subscriptionId, sub.id)).limit(1);
  const view: SubscriptionView = {
    id: sub.id, tenantId: sub.tenantId, planId: sub.planId, status: sub.status,
    startedAt: sub.startedAt.toISOString(), endsAt: sub.endsAt ? sub.endsAt.toISOString() : null,
  };
  if (trials[0]?.expiresAt) view.trialExpiresAt = trials[0].expiresAt.toISOString();
  return view;
}

/**
 * UAT W8-D (P1): tenant-scoped existence read for the activate/cancel commands. The
 * consumer updates by id inside the caller's tenant (RLS), so a subscription the
 * caller's tenant cannot see can never change; the route answers 404 for it instead of 202.
 */
export async function findIdInTenant(id: string, tenantId: string): Promise<{ id: string } | null> {
  const rows = await scopedRead((tx) => tx.select({ id: billingSubscriptions.id }).from(billingSubscriptions)
    .where(and(eq(billingSubscriptions.id, id), eq(billingSubscriptions.tenantId, tenantId))).limit(1));
  return rows[0] ?? null;
}

export async function insertSub(tx: Writer, row: BillingSubscriptionInsert): Promise<void> {
  await tx.insert(billingSubscriptions).values(row);
}

export async function insertTrial(tx: Writer, row: BillingTrialInsert): Promise<void> {
  await tx.insert(billingTrials).values(row);
}

export async function updateStatus(tx: Writer, id: string, status: string, actorId: string): Promise<void> {
  await tx.update(billingSubscriptions).set({ status, ...(status === "cancelled" ? { endsAt: sql`COALESCE(${billingSubscriptions.endsAt}, now())` } : {}), updatedBy: actorId, updatedAt: new Date(), version: sql`${billingSubscriptions.version} + 1` }).where(eq(billingSubscriptions.id, id));
}

export async function findByIdTx(tx: Writer, id: string) {
  const rows = await tx.select().from(billingSubscriptions).where(eq(billingSubscriptions.id, id)).limit(1);
  return rows[0] ?? null;
}

export type SubscriptionHistoryRow = { id: string; planId: string; status: string; startedAt: string; endsAt: string | null };

/**
 * GAP-BILLING-SUBSCRIPTIONS-03: every subscription row of ONE tenant, newest first. Tenant-scoped
 * twice over: the tenantId filter AND the FORCE-RLS scopedRead transaction. Capped so a runaway
 * history cannot produce an unbounded payload.
 */
export async function listHistoryByTenant(tenantId: string, limit = 100): Promise<SubscriptionHistoryRow[]> {
  const rows = await scopedRead((tx) =>
    tx.select().from(billingSubscriptions).where(eq(billingSubscriptions.tenantId, tenantId)).orderBy(desc(billingSubscriptions.startedAt)).limit(limit));
  return rows.map((r) => ({
    id: r.id, planId: r.planId, status: r.status,
    startedAt: r.startedAt.toISOString(), endsAt: r.endsAt ? r.endsAt.toISOString() : null,
  }));
}
