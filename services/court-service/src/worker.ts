/**
 * court-service — SQS / RabbitMQ consumer entrypoint (worker).
 *
 * Responsibilities (CQRS write side + cross-service stitching):
 *   1. Fail-fast: assert COURT_PII_KEY is configured before doing anything, so
 *      the worker never runs fail-open on party PII (DPDP Act, Req 15.3).
 *   2. Subscribe to EVERY COMMANDS topic (write intents from HTTP routes) and
 *      EVERY CONSUMED_EVENTS topic (facts owned by other services) declared in
 *      topics.ts — the single source of truth for the message contract.
 *   3. Route each delivered message to the module consumer registered for that
 *      topic in `consumerRegistry`. Modules land later; the MODULE_REGISTRARS
 *      list below is filled one registrar per module. Until a handler is
 *      registered, the router logs a WARN and acks (skip) rather than looping.
 *   4. DLQ handling: a handler failure is retried 3× with exponential backoff
 *      (1s, 2s, 4s); on exhaustion — or immediately for a NonRetryableError —
 *      the message is dead-lettered WITH FULL CONTEXT (origin topic, messageId,
 *      correlationId, tenantId, attempts, error + the original envelope) so it
 *      is never silently lost and can be investigated / replayed
 *      (steering: "every consumer MUST have DLQ handling"; design Recovery
 *      Strategies: "Retry 3x exponential backoff (1s, 2s, 4s) → DLQ").
 *   5. Start the transactional-outbox relay (publishes unsent outbox rows) plus
 *      the scheduled outbox purge (drops published rows older than 7 days).
 *   6. Graceful SIGTERM/SIGINT shutdown: stop consumers, stop the relay + purge
 *      timers, close the DB pool, then exit.
 *
 * Mirrors the sibling worker layout (finance-service / visitor-service).
 */
import { pino } from "pino";
import type { CommandEnvelope, Handler } from "@civitasone/queue";
import { isNonRetryable } from "@civitasone/queue";
import { captureError, incrementDlqMessage } from "@civitasone/observability";
import { startOutboxPurge } from "@civitasone/outbox";
import { db, sqlClient } from "./shared/db.js";
import { queue } from "./shared/infra.js";
import { startRelay } from "./shared/outbox.js";
import { assertPiiKeyConfigured } from "./shared/pii-crypto.js";
import { COMMANDS, CONSUMED_EVENTS, SERVICE } from "./topics.js";
import { registerCaseRegistryConsumers } from "./modules/case-registry/consumer.js";
import { registerCourtRegistryConsumers } from "./modules/court-registry/consumer.js";
import { registerCaseLifecycleConsumers } from "./modules/case-lifecycle/consumer.js";
import { registerHearingConsumers } from "./modules/hearing/consumer.js";
import { registerFilingConsumers } from "./modules/filing/consumer.js";
import { registerOrderConsumers } from "./modules/order/consumer.js";
import { registerCauseListConsumers } from "./modules/cause-list/consumer.js";
import { registerScrutinyConsumers } from "./modules/scrutiny/consumer.js";
import { registerNoticeConsumers } from "./modules/notice/consumer.js";
import { registerComplianceConsumers } from "./modules/compliance/consumer.js";
import { registerAppealConsumers } from "./modules/appeal/consumer.js";
import { registerPartyConsumers } from "./modules/party/consumer.js";
import { registerEvidenceConsumers } from "./modules/evidence/consumer.js";
import { registerOrderIssuanceConsumers } from "./modules/order-issuance/consumer.js";

const log = pino({ name: "court-worker" });

// (1) Fail-fast on missing/short COURT_PII_KEY — never start fail-open.
assertPiiKeyConfigured();

// ── Retry + DLQ policy (design: Recovery Strategies) ─────────────────────────
/** Max handler attempts before a message is dead-lettered. */
const MAX_ATTEMPTS = 3;
/** Exponential backoff between attempts, in ms (1s, 2s, 4s). */
const BACKOFF_MS = [1000, 2000, 4000] as const;
/** Service-owned dead-letter topic; carries failed messages + full context. */
const DLQ_TOPIC = `${SERVICE}.dlq`;

// ── Consumer registration map ────────────────────────────────────────────────
/** A module consumer handler for a single topic. */
export type ConsumerHandler<T = unknown> = (msg: CommandEnvelope<T>) => Promise<void>;

/** topic → handler. Populated by module registrars (see MODULE_REGISTRARS). */
const consumerRegistry = new Map<string, ConsumerHandler>();

/**
 * Register a module consumer for `topic`. Called by each module's
 * `register<Module>Consumers(registerConsumer)` function. Throws on a duplicate
 * registration so two modules can never silently fight over the same topic.
 */
export function registerConsumer<T>(topic: string, handler: ConsumerHandler<T>): void {
  if (consumerRegistry.has(topic)) {
    throw new Error(`court-worker: duplicate consumer registration for "${topic}"`);
  }
  consumerRegistry.set(topic, handler as ConsumerHandler);
}

// ─────────────────────────────────────────────────────────────────────────────
// MODULE CONSUMER REGISTRATION
//
// Each domain module (case-registry, court-registry, cause-list, hearing, order,
// filing) exports a `register<Module>Consumers(register)` function that maps its
// COMMANDS / CONSUMED_EVENTS topics to handlers via `registerConsumer`. Modules
// are added here as they land; the router below WARN-skips any topic without a
// registered handler.
// ─────────────────────────────────────────────────────────────────────────────
type ModuleRegistrar = (register: typeof registerConsumer) => void;

const MODULE_REGISTRARS: ModuleRegistrar[] = [
  registerCaseRegistryConsumers,
  registerCourtRegistryConsumers,
  registerCaseLifecycleConsumers,
  registerHearingConsumers,
  registerFilingConsumers,
  registerOrderConsumers,
  registerCauseListConsumers,
  registerScrutinyConsumers,
  registerNoticeConsumers,
  registerComplianceConsumers,
  registerAppealConsumers,
  registerPartyConsumers,
  registerEvidenceConsumers,
  registerOrderIssuanceConsumers,
  // registerCauseListConsumers,
  // registerHearingConsumers,
  // registerOrderConsumers,
  // registerFilingConsumers,
];

for (const register of MODULE_REGISTRARS) register(registerConsumer);

// ── Routing + DLQ ────────────────────────────────────────────────────────────
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Dead-letter a message with full investigation context. Emits a DLQ metric +
 * captured error + structured ERROR log (the durable record of last resort),
 * then best-effort re-publishes the original envelope onto the service DLQ topic
 * for replay. A DLQ publish failure is logged but never crashes the worker.
 */
async function deadLetter(originTopic: string, msg: CommandEnvelope, err: unknown): Promise<void> {
  const reason = err instanceof Error ? err.message : String(err);
  const context = {
    service: SERVICE,
    topic: originTopic,
    messageId: msg.messageId,
    correlationId: msg.correlationId,
    tenantId: msg.tenantId,
    attempts: MAX_ATTEMPTS,
    outcome: "dead-lettered" as const,
  };

  incrementDlqMessage(originTopic);
  captureError(err, context);
  log.error({ ...context, err: err instanceof Error ? err.stack : reason }, "consumer failed — routing to DLQ");

  try {
    await queue.publish(DLQ_TOPIC, {
      type: DLQ_TOPIC,
      tenantId: msg.tenantId,
      actorId: msg.actorId,
      correlationId: msg.correlationId,
      causationId: msg.messageId,
      schemaVersion: msg.schemaVersion,
      payload: {
        originTopic,
        reason,
        failedAt: new Date().toISOString(),
        attempts: MAX_ATTEMPTS,
        original: msg,
      },
    });
  } catch (publishErr) {
    log.error(
      { ...context, err: publishErr instanceof Error ? publishErr.stack : String(publishErr) },
      "failed to publish message to DLQ topic",
    );
  }
}

/**
 * Build the retry+DLQ router for `topic`. Looks up the registered module handler
 * on every delivery (so registrations added at boot are always visible), retries
 * transient failures with exponential backoff, and dead-letters on exhaustion or
 * a NonRetryableError.
 */
function makeRouter(topic: string): Handler {
  return async (msg: CommandEnvelope): Promise<void> => {
    const handler = consumerRegistry.get(topic);
    if (!handler) {
      // No module handler yet — ack + WARN so the message does not loop
      // invisibly. Becomes a real route once the module lands.
      log.warn({ topic, messageId: msg.messageId, tenantId: msg.tenantId }, "no consumer registered for topic — skipping");
      return;
    }

    let lastErr: unknown;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        await handler(msg);
        return;
      } catch (err) {
        lastErr = err;
        // Permanent business rejection — do not waste retries, dead-letter now.
        if (isNonRetryable(err)) break;
        if (attempt < MAX_ATTEMPTS) {
          await sleep(BACKOFF_MS[attempt - 1] ?? 4000);
        }
      }
    }
    await deadLetter(topic, msg, lastErr);
  };
}

// (2) Subscribe to every owned COMMANDS topic + every CONSUMED_EVENTS topic.
const SUBSCRIBED_TOPICS: readonly string[] = [
  ...Object.values(COMMANDS),
  ...(Object.values(CONSUMED_EVENTS) as readonly string[]),
];

for (const topic of SUBSCRIBED_TOPICS) {
  queue.subscribe(topic, makeRouter(topic));
}

// (5) Start the queue consumer loops + outbox relay + scheduled purge.
await queue.start();
const relay = startRelay(db, queue);
const purge = startOutboxPurge(db as unknown as Parameters<typeof startOutboxPurge>[0], {
  intervalMs: 60 * 60_000,
  batchSize: 1000,
  logger: log,
});

log.info(
  { topics: SUBSCRIBED_TOPICS.length, consumers: consumerRegistry.size },
  "court-service worker: consumers + outbox relay running",
);

// (6) Graceful shutdown — stop consumers, stop timers, close the DB pool.
async function shutdown(signal: string): Promise<void> {
  log.info({ signal }, "shutting down");
  clearInterval(purge);
  clearInterval(relay);
  await queue.stop();
  await sqlClient.end();
  log.info("shutdown complete");
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
