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
import { pgSchema, uuid, varchar, jsonb, timestamp, text } from "drizzle-orm/pg-core";
import type { PgDatabase } from "drizzle-orm/pg-core";
import { and, asc, eq, isNull, inArray, sql } from "drizzle-orm";
import type { PostgresJsQueryResultHKT } from "drizzle-orm/postgres-js";
import type { Queue } from "@civitasone/queue";
import { incrementOutboxRelayFailure, captureError } from "@civitasone/observability";
import { getTopicSchemaVersion } from "./schema-versions.js";

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
  // PERF-008: captured at enqueue() time from the per-topic registry
  // (schema-versions.ts), NOT re-derived at relay/publish time — the relay can
  // run long after enqueue, and a topic's current version may have moved on in
  // between. An event must carry the version that was actually true when the
  // business transaction that produced it committed, not whatever the topic
  // happens to be on when the relay gets around to it.
  schemaVersion: varchar("schema_version", { length: 16 }).notNull().default("1.0"),
  payload:       jsonb("payload").$type<Record<string, unknown>>().notNull(),
  createdAt:     timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  publishedAt:   timestamp("published_at", { withTimezone: true }),
});

export const processed = inbox.table("processed", {
  messageId:   uuid("message_id").primaryKey(),
  processedAt: timestamp("processed_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * G-ASYNC-1 — per-command terminal outcome, keyed by the SAME messageId the
 * command was published with (already returned to the caller in the 202
 * response as `commandId`/`id`; see relayOnce()'s SEC C1 comment above for
 * why the outbox row id and the queue messageId are the same value).
 *
 * WHY THIS EXISTS: this fleet's CQRS write path (docs/API-GUIDE.md §3.1)
 * documents "poll the resource, subscribe to the event, or use the returned
 * id to check status" as the contract for every `202 Accepted` response. The
 * pre-existing tables in this file do not fulfil that contract:
 *   - `outboxMessages.publishedAt` only proves the relay handed the message to
 *     the broker — it says nothing about what the CONSUMER did with it.
 *   - `processed` is a pure idempotency marker (messageId -> "seen once"),
 *     written only from the SUCCESS path inside a service's own handler — a
 *     handler that throws NonRetryableError (a known, permanent business
 *     rejection — see @civitasone/queue's NonRetryableError) or exhausts
 *     retries never reaches its own markProcessed() call, so today NEITHER
 *     table gains a row when a command is rejected. The only trace is a
 *     Prometheus counter + a stderr JSON log line at DLQ time (bus.ts's
 *     routeToDlq) — an on-call/ops signal, not anything a tenant-scoped API
 *     caller or frontend can query.
 * This table is the missing connective tissue, not a parallel new system:
 * it is populated automatically by the SAME shared dispatch loop
 * (services/queue-service's bus.ts) that already distinguishes success /
 * NonRetryableError / retries-exhausted internally — via the `onOutcome`
 * hook on `queue.subscribe(topic, handler, { onOutcome })` — so adopting a
 * service is "wire one callback + add one GET route", not "build a status
 * pipeline from scratch". See recordCommandOutcome()/getCommandOutcome()
 * below.
 *
 * DELIBERATELY NO ROW-LEVEL SECURITY on this table — same resolution the
 * fleet already applied to its sibling `outboxMessages` (see every service's
 * `NNNN_outbox_messages_drop_rls.sql`: "packages/outbox relayOnce polls
 * unpublished rows with no app.tenant_id GUC. Under FORCE RLS ... the
 * NOBYPASSRLS service role sees ZERO rows every cycle — permanent stall.").
 * purgeOutbox() below needs to delete old rows ACROSS ALL TENANTS with no
 * tenant GUC set, exactly like it already does for outboxMessages/processed;
 * some services' worker.ts additionally call it via a BYPASSRLS "scanner" db
 * (see e.g. procurement-service/src/shared/scanner-db.ts) and some don't
 * (e.g. notification-service, whose own scanner pool is documented
 * read-only) — this table has to work purged via EITHER, so it can't depend
 * on FORCE RLS being bypassable at all. Tenant isolation for READS is
 * therefore enforced explicitly in getCommandOutcome() below (an explicit
 * `tenantId` filter, not RLS) — the same "explicit filter, not RLS alone"
 * defense-in-depth already used elsewhere in this fleet for tenant-scoped
 * reads outside a request/consumer's own ambient GUC context (e.g.
 * procurement-service's findTenderByIdTx filters by tenantId explicitly
 * in addition to whatever RLS would otherwise enforce).
 */
export const commandResults = inbox.table("command_results", {
  messageId:  uuid("message_id").primaryKey(),
  tenantId:   uuid("tenant_id").notNull(),
  topic:      varchar("topic", { length: 128 }).notNull(),
  // 'succeeded' | 'rejected' (NonRetryableError — permanent business reason,
  // e.g. BIDDING_CLOSED, MAKER_CHECKER_VIOLATION) | 'failed' (retries
  // exhausted against a transient condition, e.g. a downstream dependency
  // that was unavailable for the whole backoff window).
  status:     varchar("status", { length: 16 }).notNull().$type<CommandOutcomeStatus>(),
  reason:     text("reason"),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
});

export const outboxSchema = { outboxMessages, processed, commandResults };

export type CommandOutcomeStatus = "succeeded" | "rejected" | "failed";

/** Structurally identical to @civitasone/queue's CommandOutcome (duck-typed, not imported — see that type's own doc comment for why). */
export interface CommandOutcome {
  messageId: string;
  tenantId: string;
  topic: string;
  status: CommandOutcomeStatus;
  reason?: string;
}

/**
 * Record a command's terminal outcome. Call this from the `onOutcome`
 * callback passed to `queue.subscribe(topic, handler, { onOutcome })` — NOT
 * from business handler code directly; bus.ts invokes onOutcome exactly once
 * per terminal delivery (success, NonRetryableError rejection, or
 * retries-exhausted failure), so this only ever needs to persist what it is
 * given.
 *
 * Idempotent (`ON CONFLICT DO NOTHING`): a redelivered message whose outcome
 * was already recorded must not overwrite the first-recorded outcome or
 * throw on the duplicate id.
 *
 * `tx` must already be scoped to the right tenant context (RLS) by the
 * caller — mirrors enqueue()/markProcessed()'s existing contract of taking
 * an already-scoped DrizzleTx rather than establishing context itself. In
 * practice: wrap the onOutcome callback in the same `runWithTenant(tenantId,
 * () => db.transaction(tx => ...))` shape those two functions' own callers
 * already use.
 */
export async function recordCommandOutcome(tx: DrizzleTx, outcome: CommandOutcome): Promise<void> {
  await tx
    .insert(commandResults)
    .values({
      messageId: outcome.messageId,
      tenantId: outcome.tenantId,
      topic: outcome.topic,
      status: outcome.status,
      reason: outcome.reason ?? null,
    })
    .onConflictDoNothing();
}

/**
 * Look up a command's outcome by the id returned in its 202 response.
 * Returns null while the command is still in flight (not yet terminal, or
 * never published) — callers should render that as "processing", matching
 * docs/API-GUIDE.md §3.1's documented "use the returned id to check status"
 * contract, which nothing previously fulfilled end-to-end.
 *
 * `tenantId` is REQUIRED and filtered on explicitly — this table has no RLS
 * (see commandResults' own doc comment above for why), so this filter is the
 * ONLY thing standing between a caller and another tenant's command outcome.
 * Always pass the CALLER's own tenantId (e.g. from resolveContext(req) in a
 * route), never a value taken from the request body/params.
 */
export async function getCommandOutcome(
  db: DrizzleTx,
  tenantId: string,
  messageId: string,
): Promise<{ status: CommandOutcomeStatus; reason: string | null; occurredAt: Date } | null> {
  const rows = await db
    .select({ status: commandResults.status, reason: commandResults.reason, occurredAt: commandResults.occurredAt })
    .from(commandResults)
    .where(and(eq(commandResults.messageId, messageId), eq(commandResults.tenantId, tenantId)))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Enqueue an event into the outbox — MUST be called inside the same tx as the
 * business write.
 *
 * PERF-008: `schemaVersion` is optional. Callers that already know their
 * topic's exact version may pass it explicitly; everyone else gets the
 * topic's current version from the registry (schema-versions.ts) resolved
 * HERE, at enqueue time, and persisted on the row — not a single hardcoded
 * literal shared by every topic. Backward compatible: every one of this
 * repo's existing call sites omits schemaVersion and keeps working unchanged.
 */
export async function enqueue(
  tx: DrizzleTx,
  e: {
    topic: string;
    eventType: string;
    tenantId: string;
    actorId: string;
    correlationId: string;
    payload: Record<string, unknown>;
    schemaVersion?: string;
  }
): Promise<void> {
  const { schemaVersion, ...rest } = e;
  await tx.insert(outboxMessages).values({
    ...rest,
    schemaVersion: schemaVersion ?? getTopicSchemaVersion(e.topic),
  });
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
            // PERF-008: the version stamped on the row at enqueue() time (per
            // the topic's registry entry in schema-versions.ts), not a single
            // hardcoded "1.0" shared by every topic regardless of what it
            // actually is. Deliberately NOT re-resolved from the registry
            // here — see enqueue()'s doc comment on why enqueue-time is the
            // correct point to fix the version, not relay time.
            correlationId: row.correlationId, schemaVersion: row.schemaVersion, payload: row.payload,
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
 * `retentionDays` (default 7). Also purges old inbox/processed entries, and
 * (G-ASYNC-1) old _inbox.command_results entries on the same retention
 * window — a service adopting recordCommandOutcome() gets purge for free
 * the moment it already calls this function for its outbox/inbox tables; no
 * separate wiring needed.
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
    batchDeleted = (result as unknown as { count?: number }).count ?? 0;
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
    inboxBatchDeleted = (result as unknown as { count?: number }).count ?? 0;
    totalDeleted += inboxBatchDeleted;
  } while (inboxBatchDeleted >= batchSize);

  // G-ASYNC-1: command_results is _inbox.processed's sibling (same schema,
  // same "consumer-side, one row per terminal delivery" shape) and needs the
  // same retention — without this it grows unbounded for the lifetime of
  // whichever service adopts it, same failure mode this function already
  // exists to prevent for the other two tables.
  let commandResultsBatchDeleted: number;
  do {
    const result = await db.execute(sql`
      DELETE FROM _inbox.command_results
      WHERE message_id IN (
        SELECT message_id FROM _inbox.command_results
        WHERE occurred_at < ${cutoff}
        LIMIT ${sql.raw(String(batchSize))}
      )
    `);
    commandResultsBatchDeleted = (result as unknown as { count?: number }).count ?? 0;
    totalDeleted += commandResultsBatchDeleted;
  } while (commandResultsBatchDeleted >= batchSize);

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
          // drizzle's postgres-js driver returns a bare array of rows for a raw
          // db.execute() SELECT, not a `{rows: [...]}` wrapper (confirmed against
          // this codebase's own driver — see e.g. the identical bare-array read in
          // services/animal-service/src/modules/registration/repo.ts's
          // nextRegistrationNumber). Reading `.rows` here always fell through to
          // `?? 0` regardless of the real count, so the >10K WARN below could never
          // fire (REL-029).
          const count = (countResult as unknown as Array<{ cnt: number }>)[0]?.cnt ?? 0;
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
