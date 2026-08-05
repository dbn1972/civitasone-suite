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
import { and, asc, eq, isNull, inArray, sql } from "drizzle-orm";
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
 * Default bound on how many outbox rows the relay publishes concurrently in a
 * single cycle. The old relay published strictly sequentially - each publish
 * paid a full SQS round-trip before the next started - so a batch of 100 rows
 * took 100 serial round-trips and drained far slower than events arrived,
 * growing the backlog without bound. Publishing with bounded concurrency
 * collapses those round-trips into waves while still capping the in-flight
 * SendMessage count (so the SQS socket pool is never overrun the way an
 * unbounded fan-out of all 100 would).
 */
export const DEFAULT_OUTBOX_RELAY_CONCURRENCY = 20;

/**
 * Resolve the per-cycle publish concurrency from OUTBOX_RELAY_CONCURRENCY.
 * A malformed or non-positive override falls back to the safe default rather
 * than silently reintroducing the sequential (concurrency-1) stall.
 */
export function resolveRelayConcurrency(
  raw: string | undefined = process.env.OUTBOX_RELAY_CONCURRENCY,
): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 1) return DEFAULT_OUTBOX_RELAY_CONCURRENCY;
  return Math.floor(parsed);
}

/**
 * Publish unsent outbox rows and mark them published. Per-row isolation: a
 * publish failure on one row is logged + counted and skipped (left unpublished
 * for the next cycle) instead of aborting the whole batch. Returns the number
 * of rows successfully published.
 *
 * Rows are published with BOUNDED CONCURRENCY (`concurrency`, default
 * OUTBOX_RELAY_CONCURRENCY / 20) rather than strictly sequentially: each wave
 * fires up to `concurrency` publishes at once via Promise.allSettled, so one
 * slow SQS round-trip no longer blocks the next row. The cap is preserved so a
 * cycle never fans out all `batch` publishes unbounded onto the SQS socket pool.
 * Only rows whose publish SUCCEEDED are marked published, in a single batched
 * UPDATE.
 *
 * ORDERING: parallelising means rows within a batch may publish out of
 * created_at order. That is acceptable here - consumers are idempotent
 * (markProcessed) and order-tolerant, and this function does not pass
 * PublishOptions, so it neither sets nor depends on FIFO MessageGroupId
 * ordering. FIFO topics still dedup via the bus default
 * MessageDeduplicationId = messageId = row.id.
 */
export async function relayOnce(
  db: DrizzleTx,
  queue: Queue,
  batch = 100,
  service = process.env.SERVICE_NAME ?? "service",
  concurrency = resolveRelayConcurrency(),
): Promise<number> {
  const rows = await db
    .select()
    .from(outboxMessages)
    .where(isNull(outboxMessages.publishedAt))
    .orderBy(asc(outboxMessages.createdAt))
    .limit(batch);
  if (rows.length === 0) return 0;

  const succeededIds: string[] = [];
  // Never below 1; the wave size is the in-flight ceiling for this cycle.
  const wave = Math.max(1, Math.floor(concurrency));

  for (let start = 0; start < rows.length; start += wave) {
    const chunk = rows.slice(start, start + wave);
    const results = await Promise.allSettled(
      chunk.map(async (row) => {
        try {
          await queue.publish(row.topic, {
            // SEC C1: forward the stable outbox row id as the messageId so a relay
            // re-publish (after a crash between publish and mark-published) reuses
            // the same id and the consumer dedupes it via markProcessed, instead of
            // the bus minting a fresh random id every cycle (which defeated
            // idempotency).
            messageId: row.id,
            type: row.eventType, tenantId: row.tenantId, actorId: row.actorId,
            correlationId: row.correlationId, schemaVersion: "1.0", payload: row.payload,
          });
          return row.id;
        } catch (err) {
          // OPS-1: a relay publish failure is observable and isolated - one row's
          // failure never aborts the batch or blocks its peers.
          incrementOutboxRelayFailure(service);
          captureError(err, { service, topic: row.topic, correlationId: row.correlationId, event: "outbox_relay_failed", outboxId: row.id });
          throw err;
        }
      }),
    );
    for (const r of results) {
      if (r.status === "fulfilled") succeededIds.push(r.value);
    }
  }

  // Mark-published: a row is marked published IFF its publish succeeded. One
  // batched UPDATE (id = ANY(succeeded)) instead of N per-row round-trips.
  if (succeededIds.length > 0) {
    await db.update(outboxMessages).set({ publishedAt: new Date() }).where(inArray(outboxMessages.id, succeededIds));
  }
  return succeededIds.length;
}

/**
 * Run relayOnce on an interval. Never rethrows: a failing cycle is logged +
 * captured and the loop continues (the old copies rethrew here, which produced
 * an uncaught exception that could kill the relay).
 */
export function startRelay(db: DrizzleTx, queue: Queue, intervalMs = 500, service = process.env.SERVICE_NAME ?? "service"): NodeJS.Timeout {
  // Backpressure: only one cycle runs at a time. Without this guard the fixed
  // interval fires a fresh relayOnce even while the previous one is still waiting
  // on slow or stuck publishes, stacking concurrent batches that each grab 100
  // rows and pile more in-flight SendMessage calls onto an already-saturated
  // socket pool — the runaway that exhausted the pool under load.
  let running = false;
  return setInterval(() => {
    if (running) return;
    running = true;
    relayOnce(db, queue, 100, service)
      .catch((err) => {
        incrementOutboxRelayFailure(service);
        captureError(err, { service, event: "outbox_relay_cycle_failed" });
      })
      .finally(() => {
        running = false;
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

/**
 * G7: Scheduled outbox purge — deletes published outbox rows older than
 * `retentionDays` (default 7). Also purges old inbox/processed entries.
 * Processes deletions in batches of `batchSize` (default 1000).
 * Returns the total number of deleted rows. Safe to call from any service worker.
 */
export async function purgeOutbox(db: DrizzleTx, retentionDays = 7, batchSize = 1000): Promise<number> {
  const cutoff = sql`now() - interval '${sql.raw(String(retentionDays))} days'`;

  // Delete published outbox messages older than retention in batches
  let totalDeleted = 0;
  let batchDeleted: number;
  do {
    const result = await db.execute(sql`
      DELETE FROM _outbox.messages
      WHERE id IN (
        SELECT id FROM _outbox.messages
        WHERE published_at IS NOT NULL AND published_at < ${cutoff}
        LIMIT ${sql.raw(String(batchSize))}
      )
    `);
    batchDeleted = (result as unknown as { rowCount?: number }).rowCount ?? 0;
    totalDeleted += batchDeleted;
  } while (batchDeleted >= batchSize);

  // Delete processed inbox entries older than retention in batches
  let inboxBatchDeleted: number;
  do {
    const result = await db.execute(sql`
      DELETE FROM _inbox.processed
      WHERE message_id IN (
        SELECT message_id FROM _inbox.processed
        WHERE processed_at < ${cutoff}
        LIMIT ${sql.raw(String(batchSize))}
      )
    `);
    inboxBatchDeleted = (result as unknown as { rowCount?: number }).rowCount ?? 0;
  } while (inboxBatchDeleted >= batchSize);

  return totalDeleted;
}

export interface OutboxPurgeOptions {
  /** Interval between purge cycles in ms (default: 60 min). */
  intervalMs?: number;
  /** Retention period in days for processed outbox rows (default: 7). */
  retentionDays?: number;
  /** Batch size for DELETE operations (default: 1000). */
  batchSize?: number;
  /** Pino-compatible logger for WARN logging (optional). */
  logger?: { warn: (obj: Record<string, unknown>, msg: string) => void };
}

/**
 * Start a periodic outbox purge. Runs every `intervalMs` (default: 1 hour).
 * Deletes processed outbox entries older than 7 days in batches of 1000.
 * Logs a WARN if a purge cycle deletes zero rows but the table exceeds 10K entries.
 * Returns the interval handle for cleanup on shutdown.
 */
export function startOutboxPurge(db: DrizzleTx, opts: OutboxPurgeOptions = {}): NodeJS.Timeout {
  const { intervalMs = 3_600_000, retentionDays = 7, batchSize = 1000, logger } = opts;

  const timer = setInterval(() => {
    void (async () => {
      try {
        const deleted = await purgeOutbox(db, retentionDays, batchSize);
        if (deleted === 0 && logger) {
          // Check if outbox has >10K entries — indicates stuck/stale situation
          const countResult = await db.execute(
            sql`SELECT count(*)::int AS cnt FROM _outbox.messages`
          );
          const count = (countResult as unknown as { rows?: Array<{ cnt: number }> }).rows?.[0]?.cnt ?? 0;
          if (count > 10_000) {
            logger.warn(
              { outboxCount: count, deleted: 0, retentionDays },
              "outbox purge deleted zero rows but table has >10K entries — possible stale/stuck state"
            );
          }
        }
      } catch {
        /* swallow — non-critical maintenance */
      }
    })();
  }, intervalMs);
  timer.unref();
  return timer;
}

export { and, eq, isNull, inArray };
