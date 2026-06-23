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
import { and, eq, isNull } from "drizzle-orm";
import type { Queue } from "@civitasone/queue";
import { incrementOutboxRelayFailure, captureError } from "@civitasone/observability";

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
  tx: any, // Drizzle transaction — typed as any to sidestep invariant overload issues
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
export async function relayOnce(db: any, queue: Queue, batch = 100, service = process.env.SERVICE_NAME ?? "service"): Promise<number> {
  const rows = await db.select().from(outboxMessages).where(isNull(outboxMessages.publishedAt)).limit(batch);
  let published = 0;
  for (const row of rows) {
    try {
      await queue.publish(row.topic, {
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
export function startRelay(db: any, queue: Queue, intervalMs = 500, service = process.env.SERVICE_NAME ?? "service"): NodeJS.Timeout {
  return setInterval(() => {
    relayOnce(db, queue, 100, service).catch((err) => {
      incrementOutboxRelayFailure(service);
      captureError(err, { service, event: "outbox_relay_cycle_failed" });
    });
  }, intervalMs);
}

/** Mark a consumed message processed (idempotency). Returns false if already seen. */
export async function markProcessed(tx: any, messageId: string): Promise<boolean> {
  const existing = await tx.select().from(processed).where(eq(processed.messageId, messageId)).limit(1);
  if (existing.length) return false;
  await tx.insert(processed).values({ messageId });
  return true;
}

export { and, eq, isNull };
