/**
 * @civitasone/outbox — canonical transactional outbox + inbox (EVT-2 / 04-T2).
 *
 * Previously copy-pasted into all 31 services' `shared/outbox.ts` (and already
 * diverging). This is the single implementation; each service's
 * `shared/outbox.ts` now re-exports it. Behaviour vs. the old copies:
 *   - `startRelay` no longer rethrows inside setInterval (that crashed the relay
 *     loop / process). It catches, logs, captures, and continues.
 *   - `relayOnce` isolates per-row publish failures so one poison row doesn't
 *     block the whole batch, and makes failures observable
 *     (`outbox_relay_failures_total` + captureError).
 *
 * The consumer writes the business row + an outbox row in the SAME transaction;
 * the relay then publishes and marks rows published — "DB committed ⇒ event will
 * be delivered" with no dual-write hole.
 */
import { pgSchema, uuid, varchar, jsonb, timestamp } from "drizzle-orm/pg-core";
import type { PgDatabase } from "drizzle-orm/pg-core";
import { and, eq, isNull } from "drizzle-orm";
import type { PostgresJsQueryResultHKT } from "drizzle-orm/postgres-js";
import type { Queue } from "@civitasone/queue";
import { incrementOutboxRelayFailure, captureError } from "@civitasone/observability";

/**
 * Minimal Drizzle surface accepted by both the full database instance and any
 * postgres-js transaction. `PgTransaction` extends `PgDatabase`, so
 * `PostgresJsDatabase<TSchema>` and `PostgresJsTransaction<TFullSchema,TSchema>`
 * are both assignable here without additional casts at call sites.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type DrizzleTx = PgDatabase<PostgresJsQueryResultHKT, any, any>;

export const outbox = pgSchema("_outbox");
export const inbox = pgSchema("_inbox");

export const outboxMessages = outbox.table("messages", {
  id:            uuid("id").primaryKey().defaultRandom(),
  topic:         varchar("topic", { length: 128 }).notNull(),
  eventType:     varchar("event_type", { length: 128 }).notNull(),
  tenantId:      uuid("tenant_id").notNull(),
  actorId:       uuid("actor_id").notNull(),
  correlationId: varchar("correlation_id", { length: 64 }).notNull(),
  payload:       jsonb("payload").$type<Record<string, unknown>>().notNull(),
  createdAt:     timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  publishedAt:   timestamp("published_at", { withTimezone: true }),
});

export const processed = inbox.table("processed", {
  messageId:   uuid("message_id").primaryKey(),
  processedAt: timestamp("processed_at", { withTimezone: true }).notNull().defaultNow(),
});

export const outboxSchema = { outboxMessages, processed };

/** Enqueue an event into the outbox — MUST be called inside the same tx as the business write. */
export async function enqueue(
  tx: DrizzleTx,
  e: { topic: string; eventType: string; tenantId: string; actorId: string; correlationId: string; payload: Record<string, unknown> }
): Promise<void> {
  await tx.insert(outboxMessages).values(e);
}

/**
 * Publish unsent outbox rows and mark them published. Per-row isolation: a
 * publish failure on one row is logged + counted and skipped (left unpublished
 * for the next cycle) instead of aborting the whole batch. Returns the number
 * of rows successfully published.
 */
export async function relayOnce(db: DrizzleTx, queue: Queue, batch = 100, service = process.env.SERVICE_NAME ?? "service"): Promise<number> {
  const rows = await db.select().from(outboxMessages).where(isNull(outboxMessages.publishedAt)).limit(batch);
  let published = 0;
  for (const row of rows) {
    try {
      await queue.publish(row.topic, {
        // SEC C1: forward the stable outbox row id as the messageId so a relay
        // re-publish (after a crash between publish and mark-published) reuses the
        // same id and the consumer dedupes it via markProcessed, instead of the bus
        // minting a fresh random id every cycle (which defeated idempotency).
        messageId: row.id,
        type: row.eventType, tenantId: row.tenantId, actorId: row.actorId,
        correlationId: row.correlationId, schemaVersion: "1.0", payload: row.payload,
      });
      await db.update(outboxMessages).set({ publishedAt: new Date() }).where(eq(outboxMessages.id, row.id));
      published++;
    } catch (err) {
      // OPS-1: a relay publish failure is now observable and isolated.
      incrementOutboxRelayFailure(service);
      captureError(err, { service, topic: row.topic, correlationId: row.correlationId, event: "outbox_relay_failed", outboxId: row.id });
    }
  }
  return published;
}

/**
 * Run relayOnce on an interval. Never rethrows: a failing cycle is logged +
 * captured and the loop continues (the old copies rethrew here, which produced
 * an uncaught exception that could kill the relay).
 */
export function startRelay(db: DrizzleTx, queue: Queue, intervalMs = 500, service = process.env.SERVICE_NAME ?? "service"): NodeJS.Timeout {
  return setInterval(() => {
    relayOnce(db, queue, 100, service).catch((err) => {
      incrementOutboxRelayFailure(service);
      captureError(err, { service, event: "outbox_relay_cycle_failed" });
    });
  }, intervalMs);
}

/** Mark a consumed message processed (idempotency). Returns false if already seen. */
export async function markProcessed(tx: DrizzleTx, messageId: string): Promise<boolean> {
  // Atomic claim: ON CONFLICT DO NOTHING + RETURNING is race-free (the old
  // SELECT-then-INSERT could let two concurrent deliveries both pass the check,
  // then one aborts on the PK). Empty return means already processed.
  const inserted = await tx.insert(processed).values({ messageId }).onConflictDoNothing().returning();
  return inserted.length > 0;
}

export { and, eq, isNull };
