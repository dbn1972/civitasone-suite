/**
 * subscriptions repo — Drizzle queries against `subscriptions.*` ONLY (L2).
 */
import { eq } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { subscriptions, type SubscriptionRow, type SubscriptionInsert } from "./schema.js";

export type SubscriptionStatus = "trial" | "active" | "past_due" | "suspended" | "cancelled";

export interface SubscriptionView {
  id: string;
  tenantId: string;
  planId: string;
  status: SubscriptionStatus;
  startDate: Date;
  endDate: Date | null;
  trialEndsAt: Date | null;
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  cancelledAt: Date | null;
  cancelReason: string | null;
  version: number;
}

function toView(r: SubscriptionRow): SubscriptionView {
  return {
    id: r.id,
    tenantId: r.tenantId,
    planId: r.planId,
    status: r.status,
    startDate: r.startDate,
    endDate: r.endDate,
    trialEndsAt: r.trialEndsAt,
    currentPeriodStart: r.currentPeriodStart,
    currentPeriodEnd: r.currentPeriodEnd,
    cancelledAt: r.cancelledAt,
    cancelReason: r.cancelReason,
    version: r.version,
  };
}

// ── reads (query path) ───────────────────────────────────────────────
export async function findById(id: string): Promise<SubscriptionView | null> {
  const rows = await db.select().from(subscriptions).where(eq(subscriptions.id, id)).limit(1);
  return rows[0] ? toView(rows[0]) : null;
}

export async function findByTenantId(tenantId: string): Promise<SubscriptionView | null> {
  const rows = await db.select().from(subscriptions).where(eq(subscriptions.tenantId, tenantId)).limit(1);
  return rows[0] ? toView(rows[0]) : null;
}

// ── writes (consumer only, within a tx) ──────────────────────────────
export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export async function insert(tx: Writer, row: SubscriptionInsert): Promise<void> {
  await tx.insert(subscriptions).values(row);
}

export async function update(tx: Writer, id: string, patch: Partial<SubscriptionInsert>): Promise<void> {
  await tx.update(subscriptions).set({ ...patch, updatedAt: new Date() }).where(eq(subscriptions.id, id));
}

export async function findByIdTx(tx: Writer, id: string): Promise<SubscriptionView | null> {
  const rows = await tx.select().from(subscriptions).where(eq(subscriptions.id, id)).limit(1);
  return rows[0] ? toView(rows[0]) : null;
}

export async function findByTenantIdTx(tx: Writer, tenantId: string): Promise<SubscriptionView | null> {
  const rows = await tx.select().from(subscriptions).where(eq(subscriptions.tenantId, tenantId)).limit(1);
  return rows[0] ? toView(rows[0]) : null;
}
