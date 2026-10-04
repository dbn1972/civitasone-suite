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
import { runWithTenant } from "@civitasone/db";
import type { Db } from "./db.js";
import { scannerDb } from "./scanner-db.js";
import { enqueue } from "./outbox.js";
import * as keycloak from "./keycloak.js";

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

/**
 * Discover due pending reconciliations across ALL tenants. identity_kc_reconciliations is under FORCE RLS, so this runs
 * on the read-only BYPASSRLS scanner connection (migration 0030 grants it SELECT). It only finds candidates; claiming and
 * every write happen per row in that row's tenant-context transaction (claimRow / markReconciled / markRetry).
 */
export async function claimDue(scanner: Pick<Db, "select">, limit = 20): Promise<KcReconciliationRow[]> {
  return scanner.select().from(kcReconciliations)
    .where(and(eq(kcReconciliations.status, "pending"), lte(kcReconciliations.nextAttemptAt, new Date())))
    .orderBy(kcReconciliations.nextAttemptAt)
    .limit(limit);
}

/** Run `fn` in a tenant-context transaction (sets the RLS GUC) for one reconciliation row. */
async function inTenant<T>(database: Db, tenantId: string, fn: (tx: Parameters<Parameters<Db["transaction"]>[0]>[0]) => Promise<T>): Promise<T> {
  return await runWithTenant(tenantId, () => database.transaction(fn as Parameters<Db["transaction"]>[0]) as Promise<T>);
}

/** Lease length: a claimed row is hidden from other workers (next_attempt_at pushed out) while Keycloak is called. */
const CLAIM_LEASE_MS = 5 * 60_000;

/**
 * Claim one row for processing: FOR UPDATE SKIP LOCKED inside the row's tenant transaction, re-check it is still
 * pending and due, then lease it (next_attempt_at += lease). Returns the fresh row, or null when another worker holds
 * it or it was resolved meanwhile, so two workers never process the same row.
 */
export async function claimRow(database: Db, row: KcReconciliationRow): Promise<KcReconciliationRow | null> {
  return inTenant(database, row.tenantId, async (tx) => {
    const [fresh] = await tx.select().from(kcReconciliations)
      .where(and(eq(kcReconciliations.id, row.id), eq(kcReconciliations.status, "pending"), lte(kcReconciliations.nextAttemptAt, new Date())))
      .for("update", { skipLocked: true });
    if (!fresh) return null;
    await tx.update(kcReconciliations)
      .set({ nextAttemptAt: new Date(Date.now() + CLAIM_LEASE_MS), updatedAt: new Date() })
      .where(eq(kcReconciliations.id, row.id));
    return fresh;
  });
}

/** Mark a reconciliation done (in the row's tenant context). */
export async function markReconciled(database: Db, row: Pick<KcReconciliationRow, "id" | "tenantId">): Promise<void> {
  await inTenant(database, row.tenantId, async (tx) => {
    await tx.update(kcReconciliations)
      .set({ status: "reconciled", updatedAt: new Date() })
      .where(eq(kcReconciliations.id, row.id));
  });
}

/**
 * Resolve the open (pending) deactivation obligation for a (tenant, user) once
 * Keycloak has confirmed the disable. Uses the global db; safe to call from the
 * post-commit best-effort path.
 */
export async function resolvePendingDeactivation(tenantId: string, userId: string): Promise<void> {
  const { db } = await import("./db.js");
  // Inside a transaction: only db.transaction sets the tenant GUC, and a bare db.update under the row-level-security
  // policy matches zero rows, which left every resolved obligation pending and re-disabled by the reconciler.
  await db.transaction(async (tx) => {
    await tx.update(kcReconciliations)
      .set({ status: "reconciled", updatedAt: new Date() })
      .where(and(
        eq(kcReconciliations.tenantId, tenantId),
        eq(kcReconciliations.userId, userId),
        eq(kcReconciliations.action, "deactivate"),
        eq(kcReconciliations.status, "pending"),
      ));
  });
}

/** Max Keycloak deprovision attempts before a row goes terminal `failed` (env KC_RECONCILE_MAX_ATTEMPTS, default 12). */
export function kcMaxAttempts(): number {
  const n = Number(process.env.KC_RECONCILE_MAX_ATTEMPTS ?? 12);
  return Number.isInteger(n) && n > 0 ? n : 12;
}

const SYSTEM_ACTOR_ID = "00000000-0000-0000-0000-000000000001";

/**
 * Record a failed attempt in the row's tenant context. Schedules an exponential-backoff retry; once `attempts` reaches
 * the maximum the row becomes terminal `failed` and a high-severity `kc_deprovision_failed` audit event is emitted through
 * the outbox in the same transaction (the user is deactivated in the DB but may still be enabled in Keycloak: needs a human).
 * Returns "failed" when exhausted, else "retry".
 */
export async function markRetry(
  database: Db,
  row: Pick<KcReconciliationRow, "id" | "tenantId" | "userId" | "attempts" | "correlationId">,
  error: string,
  maxAttempts = kcMaxAttempts(),
): Promise<"retry" | "failed"> {
  const attempts = row.attempts + 1;
  const backoffMs = Math.min(60_000 * 2 ** Math.min(row.attempts, 6), 3_600_000); // cap 1h
  const exhausted = attempts >= maxAttempts;
  await inTenant(database, row.tenantId, async (tx) => {
    await tx.update(kcReconciliations)
      .set({
        attempts,
        lastError: error,
        status: exhausted ? "failed" : "pending",
        nextAttemptAt: new Date(Date.now() + backoffMs),
        updatedAt: new Date(),
      })
      .where(eq(kcReconciliations.id, row.id));
    if (exhausted) {
      await enqueue(tx as Parameters<typeof enqueue>[0], {
        topic: "audit.event.record", eventType: "audit.event.record", tenantId: row.tenantId, actorId: SYSTEM_ACTOR_ID,
        correlationId: row.correlationId ?? row.id,
        payload: {
          service: "identity", action: "kc_deprovision_failed", resourceType: "user", resourceId: row.userId,
          outcome: "failure", severity: "high", reason: error.slice(0, 500), attempts,
        },
      });
    }
  });
  return exhausted ? "failed" : "retry";
}

/** Count outstanding (pending) reconciliations across tenants, via the scanner connection. */
export async function countPending(scanner: Pick<Db, "select">): Promise<number> {
  const rows = await scanner.select({ n: sql<number>`count(*)::int` }).from(kcReconciliations)
    .where(eq(kcReconciliations.status, "pending"));
  return rows[0]?.n ?? 0;
}

/**
 * SEC H2 -- worker reconciler pass. `scanner` finds due pending rows across tenants (read-only BYPASSRLS); each row is then
 * claimed (SKIP LOCKED + lease) and finished in its own tenant-context transaction on `database`. On success the row is
 * marked reconciled; on failure a backed-off retry is scheduled, and after the max attempts the row becomes `failed` with
 * a `kc_deprovision_failed` audit event. Returns { reconciled, retried, failed }.
 */
export async function reconcileDueDeactivations(
  database: Db,
  deactivate: (tenantId: string, email: string) => Promise<{ ok: boolean; skipped?: boolean; reason?: string }>,
  limit = 20,
  opts: { scanner?: Pick<Db, "select">; maxAttempts?: number } = {},
): Promise<{ reconciled: number; retried: number; failed: number }> {
  const scanner = opts.scanner ?? scannerDb;
  const maxAttempts = opts.maxAttempts ?? kcMaxAttempts();
  const due = await claimDue(scanner, limit);
  let reconciled = 0;
  let retried = 0;
  let failed = 0;
  const fail = async (row: KcReconciliationRow, reason: string) => {
    if ((await markRetry(database, row, reason, maxAttempts)) === "failed") failed++; else retried++;
  };
  for (const candidate of due) {
    const row = await claimRow(database, candidate);
    if (!row) continue; // another worker has it, or it was resolved meanwhile
    try {
      const r = await deactivate(row.tenantId, row.email);
      if (r.ok && !r.skipped) {
        await markReconciled(database, row);
        reconciled++;
      } else if (r.skipped) {
        // Keycloak is not configured: nothing to do now. Re-queue without spending an attempt.
        await markRetry(database, { ...row, attempts: row.attempts - 1 }, "keycloak disabled", Number.MAX_SAFE_INTEGER);
        retried++;
      } else {
        await fail(row, r.reason ?? "unknown");
      }
    } catch (err) {
      await fail(row, String(err));
    }
  }
  return { reconciled, retried, failed };
}

type KcLog = { info: (o: unknown, m: string) => void; warn: (o: unknown, m: string) => void; error: (o: unknown, m: string) => void };

/**
 * Post-commit Keycloak deprovision shared by every deactivation path (status route and SCIM): disable the
 * realm user and log out all their sessions. The outcome is recorded: success resolves the pending row written in
 * the deactivating transaction; failure (or a throw) leaves it pending so reconcileDueDeactivations retries it.
 */
export async function deprovisionInKeycloak(tenantId: string, userId: string, email: string, log: KcLog): Promise<void> {
  try {
    const r = await keycloak.deactivateUser(tenantId, email, log);
    if (r.skipped) return;
    log.info({ userId, result: r }, "keycloak deactivate");
    if (r.ok) await resolvePendingDeactivation(tenantId, userId);
    else log.warn({ userId, reason: r.reason }, "keycloak deactivate failed — left for reconciler");
  } catch (err) {
    log.error({ userId, err: String(err) }, "keycloak deactivate threw — left for reconciler");
  }
}
