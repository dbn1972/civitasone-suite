/**
 * subscriptions repo — Drizzle queries against `subscriptions.*` ONLY (L2).
 */
import { eq, and, desc, sql, isNull } from "drizzle-orm";
import { runWithTenant } from "@civitasone/db";
import { db } from "../../shared/db.js";
import { subscriptions, downgradeRequests, type SubscriptionRow, type SubscriptionInsert, type DowngradeRequestRow } from "./schema.js";

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
// FQ12 (#139-#144, #147): subscriptions.subscriptions is FORCE RLS
// (tenant_id = tenant.current_tenant_id()). A bare db.select() never sets the
// app.tenant_id GUC, so these reads returned nothing for every tenant. They
// now run through runWithTenant + db.transaction like findByTenantIdScoped.
export async function findById(id: string, tenantId: string): Promise<SubscriptionView | null> {
  const rows = await runWithTenant(tenantId, () => db.transaction((tx) => tx.select().from(subscriptions)
    .where(and(eq(subscriptions.id, id), eq(subscriptions.tenantId, tenantId))).limit(1)));
  return rows[0] ? toView(rows[0]) : null;
}

/** Tenant-scoped (GUC-carrying) subscription read for the downgrade flow; see plans/repo.ts findByIdScoped. */
export async function findByTenantIdScoped(tenantId: string): Promise<SubscriptionView | null> {
  const rows = await runWithTenant(tenantId, () => db.transaction((tx) => tx.select().from(subscriptions).where(eq(subscriptions.tenantId, tenantId)).limit(1)));
  return rows[0] ? toView(rows[0]) : null;
}

export async function findByTenantId(tenantId: string): Promise<SubscriptionView | null> {
  return findByTenantIdScoped(tenantId);
}

// ── downgrade requests (owner decision #24) ─────────────────────────────
export type DowngradeRequestView = Omit<DowngradeRequestRow, "createdAt" | "updatedAt" | "version">;

function toDowngradeView(r: DowngradeRequestRow): DowngradeRequestView {
  const { createdAt: _c, updatedAt: _u, version: _v, ...rest } = r;
  return rest;
}

/** The caller's own tenant's requests, newest first. Tenant-scoped (RLS + explicit predicate). */
export async function listDowngradeRequests(tenantId: string, limit = 20): Promise<DowngradeRequestView[]> {
  const rows = await runWithTenant(tenantId, () => db.transaction((tx) => tx.select().from(downgradeRequests)
    .where(eq(downgradeRequests.tenantId, tenantId)).orderBy(desc(downgradeRequests.requestedAt)).limit(limit)));
  return rows.map(toDowngradeView);
}

export async function findPendingDowngrade(tenantId: string): Promise<DowngradeRequestView | null> {
  const rows = await runWithTenant(tenantId, () => db.transaction((tx) => tx.select().from(downgradeRequests)
    .where(and(eq(downgradeRequests.tenantId, tenantId), eq(downgradeRequests.status, "pending"))).limit(1)));
  return rows[0] ? toDowngradeView(rows[0]) : null;
}

/** F8: an approved downgrade that has not been applied yet (scheduled for the period end). */
export async function findScheduledDowngrade(tenantId: string): Promise<DowngradeRequestView | null> {
  const rows = await runWithTenant(tenantId, () => db.transaction((tx) => tx.select().from(downgradeRequests)
    .where(and(eq(downgradeRequests.tenantId, tenantId), eq(downgradeRequests.status, "approved"), isNull(downgradeRequests.appliedAt))).limit(1)));
  return rows[0] ? toDowngradeView(rows[0]) : null;
}

export async function findDowngradeRequest(tenantId: string, id: string): Promise<DowngradeRequestView | null> {
  const rows = await runWithTenant(tenantId, () => db.transaction((tx) => tx.select().from(downgradeRequests)
    .where(and(eq(downgradeRequests.tenantId, tenantId), eq(downgradeRequests.id, id))).limit(1)));
  return rows[0] ? toDowngradeView(rows[0]) : null;
}

/**
 * Platform billing's queue: pending requests of ALL tenants, through the
 * SECURITY DEFINER function of migration 0032. CALLERS MUST be role-gated.
 */
export async function listPendingDowngradesForPlatform(limit = 100): Promise<Array<Record<string, unknown>>> {
  const res = await db.execute(sql`SELECT * FROM subscriptions.list_pending_downgrades(${limit}::int)`);
  const raw: Array<Record<string, unknown>> = Array.isArray(res)
    ? (res as unknown as Array<Record<string, unknown>>)
    : (res as unknown as { rows: Array<Record<string, unknown>> }).rows;
  return raw.map((r) => ({
    id: String(r.id),
    tenantId: String(r.tenant_id),
    fromPlanId: String(r.from_plan_id),
    targetPlanId: String(r.target_plan_id),
    reason: String(r.reason),
    usageSnapshot: r.usage_snapshot,
    requestedBy: String(r.requested_by),
    requestedAt: new Date(r.requested_at as string | Date).toISOString(),
  }));
}

/**
 * F8: approved downgrades whose period has ended, across tenants, through the
 * SECURITY DEFINER function of migration 0033. Only the sweeper may call this.
 */
export async function listDueDowngradesForPlatform(limit = 100): Promise<Array<{ id: string; tenantId: string; decidedBy: string }>> {
  const res = await db.execute(sql`SELECT * FROM subscriptions.list_due_downgrades(${limit}::int)`);
  const raw: Array<Record<string, unknown>> = Array.isArray(res)
    ? (res as unknown as Array<Record<string, unknown>>)
    : (res as unknown as { rows: Array<Record<string, unknown>> }).rows;
  return raw.map((r) => ({ id: String(r.id), tenantId: String(r.tenant_id), decidedBy: String(r.decided_by) }));
}

// ── writes (consumer only, within a tx) ──────────────────────────────
export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export async function insert(tx: Writer, row: SubscriptionInsert): Promise<void> {
  await tx.insert(subscriptions).values(row);
}

export async function update(tx: Writer, id: string, patch: Partial<SubscriptionInsert>): Promise<void> {
  await tx.update(subscriptions).set({ ...patch, updatedAt: new Date() }).where(eq(subscriptions.id, id));
}

// CLOS3-S6-07: the *Tx readers are used only inside the consumers write transactions, where the row is
// read, checked with assertTransition and then updated. FOR UPDATE row-locks it so concurrent commands
// (separate topics, independent poll loops) serialise and the second re-reads the committed status.
export async function findByIdTx(tx: Writer, id: string): Promise<SubscriptionView | null> {
  const rows = await tx.select().from(subscriptions).where(eq(subscriptions.id, id)).limit(1).for("update");
  return rows[0] ? toView(rows[0]) : null;
}

export async function findByTenantIdTx(tx: Writer, tenantId: string): Promise<SubscriptionView | null> {
  const rows = await tx.select().from(subscriptions).where(eq(subscriptions.tenantId, tenantId)).limit(1).for("update");
  return rows[0] ? toView(rows[0]) : null;
}
