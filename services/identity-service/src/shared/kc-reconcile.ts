/**
 * SEC H2 — durable Keycloak deactivation reconciliation.
 *
 * deactivateUser was best-effort fire-and-forget: a Keycloak failure left the
 * user enabled in the realm with live sessions, and the failure was only
 * logged. This module records every Keycloak deactivation that could not be
 * confirmed into a durable table (`identity_kc_reconciliations`) so the worker
 * reconciler retries it until it succeeds, and surfaces a high-severity
 * unreconciled flag + audit while it is outstanding.
 */
import { pgTable, uuid, varchar, integer, text, timestamp } from "drizzle-orm/pg-core";
import { and, eq, lte, sql } from "drizzle-orm";
import type { Db } from "./db.js";

export const kcReconciliations = pgTable("identity_kc_reconciliations", {
  id:            uuid("id").primaryKey().defaultRandom(),
  tenantId:      uuid("tenant_id").notNull(),
  userId:        uuid("user_id").notNull(),
  email:         varchar("email", { length: 320 }).notNull(),
  action:        varchar("action", { length: 24 }).notNull(),
  status:        varchar("status", { length: 24 }).notNull().default("pending"),
  attempts:      integer("attempts").notNull().default(0),
  lastError:     text("last_error"),
  severity:      varchar("severity", { length: 16 }).notNull().default("high"),
  correlationId: varchar("correlation_id", { length: 64 }),
  createdAt:     timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:     timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
});

export type KcReconciliationRow = typeof kcReconciliations.$inferSelect;

export const kcReconcileSchema = { kcReconciliations };

/**
 * Record a pending deactivation that needs reconciliation. Idempotent against
 * the partial unique index (tenant_id, user_id, action) WHERE status='pending':
 * a second failure for the same open item is dropped (the existing open row is
 * retained for retry).
 *
 * `tx` is the consumer's Drizzle transaction (typed loosely like the rest of
 * the outbox call sites to sidestep Drizzle's invariant insert overloads).
 */
export async function recordPendingDeactivation(
  tx: { insert: Db["insert"] },
  row: { tenantId: string; userId: string; email: string; correlationId: string; lastError: string },
): Promise<void> {
  await tx.insert(kcReconciliations)
    .values({
      tenantId: row.tenantId, userId: row.userId, email: row.email, action: "deactivate",
      status: "pending", attempts: 1, lastError: row.lastError, severity: "high",
      correlationId: row.correlationId, nextAttemptAt: new Date(),
    })
    .onConflictDoNothing();
}

/** Claim a batch of due pending reconciliations (oldest next_attempt_at first). */
export async function claimDue(database: Db, limit = 20): Promise<KcReconciliationRow[]> {
  return database.select().from(kcReconciliations)
    .where(and(eq(kcReconciliations.status, "pending"), lte(kcReconciliations.nextAttemptAt, new Date())))
    .limit(limit);
}

/** Mark a reconciliation done. */
export async function markReconciled(database: Db, id: string): Promise<void> {
  await database.update(kcReconciliations)
    .set({ status: "reconciled", updatedAt: new Date() })
    .where(eq(kcReconciliations.id, id));
}

/**
 * Resolve the open (pending) deactivation obligation for a (tenant, user) once
 * Keycloak has confirmed the disable. Uses the global db; safe to call from the
 * post-commit best-effort path.
 */
export async function resolvePendingDeactivation(tenantId: string, userId: string): Promise<void> {
  const { db } = await import("./db.js");
  await db.update(kcReconciliations)
    .set({ status: "reconciled", updatedAt: new Date() })
    .where(and(
      eq(kcReconciliations.tenantId, tenantId),
      eq(kcReconciliations.userId, userId),
      eq(kcReconciliations.action, "deactivate"),
      eq(kcReconciliations.status, "pending"),
    ));
}

/** Record a retry failure with exponential backoff on next_attempt_at. */
export async function markRetry(database: Db, id: string, attempts: number, error: string): Promise<void> {
  const backoffMs = Math.min(60_000 * 2 ** Math.min(attempts, 6), 3_600_000); // cap 1h
  await database.update(kcReconciliations)
    .set({
      attempts: attempts + 1,
      lastError: error,
      nextAttemptAt: new Date(Date.now() + backoffMs),
      updatedAt: new Date(),
    })
    .where(eq(kcReconciliations.id, id));
}

/** Count outstanding (pending) high-severity reconciliations — for observability. */
export async function countPending(database: Db): Promise<number> {
  const rows = await database.select({ n: sql<number>`count(*)::int` }).from(kcReconciliations)
    .where(eq(kcReconciliations.status, "pending"));
  return rows[0]?.n ?? 0;
}

/**
 * SEC H2 — worker reconciler pass. Claims due pending deactivations and retries
 * the Keycloak disable. On success marks reconciled; on failure schedules a
 * backed-off retry. Returns { reconciled, retried }.
 */
export async function reconcileDueDeactivations(
  database: Db,
  deactivate: (tenantId: string, email: string) => Promise<{ ok: boolean; skipped?: boolean; reason?: string }>,
  limit = 20,
): Promise<{ reconciled: number; retried: number }> {
  const due = await claimDue(database, limit);
  let reconciled = 0;
  let retried = 0;
  for (const row of due) {
    try {
      const r = await deactivate(row.tenantId, row.email);
      if (r.ok && !r.skipped) {
        await markReconciled(database, row.id);
        reconciled++;
      } else if (r.skipped) {
        // Keycloak disabled: nothing to do now; retry later (cheap no-op).
        await markRetry(database, row.id, row.attempts, "keycloak disabled");
        retried++;
      } else {
        await markRetry(database, row.id, row.attempts, r.reason ?? "unknown");
        retried++;
      }
    } catch (err) {
      await markRetry(database, row.id, row.attempts, String(err));
      retried++;
    }
  }
  return { reconciled, retried };
}
