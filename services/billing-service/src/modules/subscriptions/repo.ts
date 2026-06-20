import { eq } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { billingSubscriptions, billingTrials, type BillingSubscriptionInsert, type BillingTrialInsert } from "./schema.js";
import type { SubscriptionView } from "./domain.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export async function findByTenant(tenantId: string): Promise<SubscriptionView | null> {
  const rows = await db.select().from(billingSubscriptions).where(eq(billingSubscriptions.tenantId, tenantId)).limit(1);
  if (!rows[0]) return null;
  const trials = await db.select().from(billingTrials).where(eq(billingTrials.subscriptionId, rows[0].id)).limit(1);
  const view: SubscriptionView = {
    id: rows[0].id, tenantId: rows[0].tenantId, planId: rows[0].planId, status: rows[0].status,
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
