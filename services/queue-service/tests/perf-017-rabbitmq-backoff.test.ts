import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { RabbitMqQueue, resolveRabbitBackoffBaseSeconds, resolveRabbitBackoffMaxSeconds } from "../src/adapters/rabbitmq.js";
import { DEFAULT_SQS_BACKOFF_BASE_SECONDS, DEFAULT_SQS_BACKOFF_MAX_SECONDS } from "../src/bus.js";
import { getDlqMessageCount, resetFailureMetrics } from "@civitasone/observability";

/**
 * PERF-017: the RabbitMQ adapter had the identical missing-retry-backoff
 * pattern already fixed for SQS by PERF-004 — a failed-but-retryable message
 * was nack'd with requeue=true, which RabbitMQ redelivers immediately, at a
 * fixed rate, for every attempt up to RABBITMQ_MAX_RETRIES. Separately (found
 * while implementing this fix, not called out by the gap's own evidence): the
 * "x-delivery-count" header the adapter read to decide DLQ-vs-retry was never
 * actually written anywhere, so deliveryCount was permanently stuck at 1 and
 * the retry path could never reach maxRetries at all — a poison message would
 * have looped between "processing" and "immediate nack-requeue" forever.
 *
 * RabbitMQ has no ChangeMessageVisibility equivalent, so this fix uses the
 * standard TTL + dead-letter-exchange "parking lot" pattern instead: a failed
 * message is acked off the main queue and republished into a per-delay retry
 * queue (`{queue}.retry.{seconds}s`) whose x-message-ttl is the backoff delay
 * and whose own dead-letter-exchange routes it straight back to the original
 * queue once the TTL elapses. The `rabbitmq_delayed_message_exchange` plugin
 * was checked first (`rabbitmq-plugins list` against a disposable rabbitmq:3-
 * management container) and confirmed NOT present in the standard image and
 * NOT provisioned anywhere in this repo's infra — this fleet has no
 * docker-compose/Helm RabbitMQ deployment at all, "on-premise alternative to
 * SQS" is presently opt-in via env vars only — so the TTL+DLX approach (zero
 * non-standard plugins, and already the pattern this same file uses for its
 * permanent-failure DLQ) is the reliable choice, not the plugin.
 *
 * GATED on RABBITMQ_URL — exactly like sqs.localstack.test.ts gates on
 * AWS_ENDPOINT_URL. With no RabbitMQ this whole suite SKIPS cleanly in CI;
 * point it at a real (ideally disposable/isolated) broker to run it:
 *
 *   RABBITMQ_URL=amqp://localhost:5672 QUEUE_DRIVER=rabbitmq \
 *   pnpm --filter @civitasone/queue-service test -- perf-017
 */
const rabbitUrl = process.env.RABBITMQ_URL;

function publishInput(type: string) {
  return {
    type,
    tenantId: "tenant-1",
    actorId: "actor-1",
    correlationId: randomUUID(),
    schemaVersion: "1.0",
    payload: { hello: "world" },
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ── Pure resolver tests — no broker needed, always run ──────────────────────

describe("resolveRabbitBackoff{Base,Max}Seconds (PERF-017)", () => {
  it("defaults to the same 1s/60s curve as PERF-004/skill 07 when unset", () => {
    expect(resolveRabbitBackoffBaseSeconds(undefined)).toBe(DEFAULT_SQS_BACKOFF_BASE_SECONDS);
    expect(resolveRabbitBackoffMaxSeconds(undefined)).toBe(DEFAULT_SQS_BACKOFF_MAX_SECONDS);
    expect(DEFAULT_SQS_BACKOFF_BASE_SECONDS).toBe(1);
    expect(DEFAULT_SQS_BACKOFF_MAX_SECONDS).toBe(60);
  });

  it("honors RABBITMQ_BACKOFF_BASE_SECONDS / RABBITMQ_BACKOFF_MAX_SECONDS overrides", () => {
    expect(resolveRabbitBackoffBaseSeconds("3")).toBe(3);
    expect(resolveRabbitBackoffMaxSeconds("120")).toBe(120);
  });

  it("falls back to the default on a malformed override instead of throwing", () => {
    expect(resolveRabbitBackoffBaseSeconds("not-a-number")).toBe(DEFAULT_SQS_BACKOFF_BASE_SECONDS);
    expect(resolveRabbitBackoffMaxSeconds("0")).toBe(DEFAULT_SQS_BACKOFF_MAX_SECONDS);
  });
});

// ── Real RabbitMQ integration — poison message, backoff, DLQ, exactly-once ──

describe.skipIf(!rabbitUrl)("RabbitMqQueue ↔ real RabbitMQ (PERF-017)", () => {
  let queue: RabbitMqQueue;

  beforeAll(() => {
    // Small maxRetries so the DLQ path is reached within the test without
    // waiting through the full 1/2/4/8/16s curve — mirrors PERF-004's own
    // SQS_MAX_RECEIVE_COUNT=4 test, which produces the same [1,2,4] curve.
    process.env.RABBITMQ_MAX_RETRIES = "4";
    delete process.env.RABBITMQ_BACKOFF_BASE_SECONDS;
    delete process.env.RABBITMQ_BACKOFF_MAX_SECONDS;
  });

  beforeEach(() => {
    resetFailureMetrics();
  });

  afterEach(async () => {
    if (queue) await queue.stop();
  });

  it("a handler that always fails is redelivered with increasing delay, then DLQs with dlq_total incremented", async () => {
    const topic = `qtest.poison.${randomUUID().slice(0, 8)}`;
    const attemptTimestamps: number[] = [];

    queue = new RabbitMqQueue();
    queue.subscribe(topic, async () => {
      attemptTimestamps.push(Date.now());
      throw new Error("always fails");
    });
    await queue.start();
    await queue.publish(topic, publishInput(topic));

    // 4 attempts with backoff [1,2,4]s between them ≈ 7s minimum, plus
    // broker/scheduling overhead — generous deadline, tight assertions.
    const deadline = Date.now() + 25_000;
    while (attemptTimestamps.length < 4 && Date.now() < deadline) {
      await sleep(50);
    }
    // Give the final (4th, DLQ-bound) attempt's nack a moment to land.
    await sleep(300);

    expect(attemptTimestamps.length).toBe(4); // == RABBITMQ_MAX_RETRIES

    const deltasMs = attemptTimestamps.slice(1).map((t, i) => t - attemptTimestamps[i]);
    // The core PERF-017 assertion: strictly increasing gaps between
    // redeliveries — the whole point being to disprove the old fixed-rate
    // (near-zero, uniform) redelivery this replaces.
    for (let i = 1; i < deltasMs.length; i++) {
      expect(deltasMs[i]).toBeGreaterThan(deltasMs[i - 1]);
    }
    // And roughly on-curve (1s, 2s, 4s), not just "increasing by 1ms".
    expect(deltasMs[0]).toBeGreaterThanOrEqual(900);
    expect(deltasMs[0]).toBeLessThan(3000);
    expect(deltasMs[1]).toBeGreaterThanOrEqual(1800);
    expect(deltasMs[1]).toBeLessThan(5000);

    expect(getDlqMessageCount(topic, "max_retries_exceeded")).toBe(1);
  }, 30_000);

  it("a message that fails twice then succeeds is redelivered with backoff but processed exactly once", async () => {
    const topic = `qtest.retry-success.${randomUUID().slice(0, 8)}`;
    const attemptTimestamps: number[] = [];
    let successes = 0;

    queue = new RabbitMqQueue();
    queue.subscribe(topic, async () => {
      attemptTimestamps.push(Date.now());
      if (attemptTimestamps.length < 3) throw new Error("transient failure");
      successes += 1;
    });
    await queue.start();
    await queue.publish(topic, publishInput(topic));

    const deadline = Date.now() + 20_000;
    while (successes === 0 && Date.now() < deadline) {
      await sleep(50);
    }
    // Prove it does NOT get redelivered again after the successful ack,
    // despite the backoff plumbing having just handled it twice.
    await sleep(1500);

    expect(attemptTimestamps.length).toBe(3);
    expect(successes).toBe(1); // exactly once, not 2+ and not 0

    const deltasMs = attemptTimestamps.slice(1).map((t, i) => t - attemptTimestamps[i]);
    expect(deltasMs[1]).toBeGreaterThan(deltasMs[0]); // 2s gap > 1s gap

    expect(getDlqMessageCount(topic)).toBe(0); // never dead-lettered — it succeeded
  }, 30_000);

  it("does not re-fan a retry to other services subscribed to the same topic", async () => {
    // Design claim being checked here: the retry queue's dead-letter-exchange
    // is the *default* exchange with routing key = the failing service's own
    // main queue name, not the topic's fanout exchange — so when service A's
    // copy of a message backs off and comes back, service B's independent
    // queue for the same topic must NOT receive a second/duplicate delivery.
    const topic = `qtest.fanout-isolation.${randomUUID().slice(0, 8)}`;
    const origService = process.env.SERVICE_NAME;

    process.env.SERVICE_NAME = "svc-a-perf017";
    const queueA = new RabbitMqQueue();
    let svcAAttempts = 0;
    queueA.subscribe(topic, async () => {
      svcAAttempts += 1;
      if (svcAAttempts < 2) throw new Error("svc-a transient failure");
    });
    await queueA.start();

    process.env.SERVICE_NAME = "svc-b-perf017";
    const queueB = new RabbitMqQueue();
    let svcBCalls = 0;
    queueB.subscribe(topic, async () => { svcBCalls += 1; });
    await queueB.start();

    process.env.SERVICE_NAME = origService;
    const publisher = new RabbitMqQueue();
    await publisher.publish(topic, publishInput(topic));

    // svc-a fails once (~1s backoff) then succeeds on redelivery; svc-b's own
    // copy succeeds immediately. Wait well past svc-a's backoff window so a
    // leaked re-fan into svc-b's queue would have had time to arrive.
    const deadline = Date.now() + 15_000;
    while (svcAAttempts < 2 && Date.now() < deadline) await sleep(50);
    await sleep(2000);

    await queueA.stop();
    await queueB.stop();

    expect(svcAAttempts).toBe(2); // failed once, succeeded on the backoff retry
    expect(svcBCalls).toBe(1); // exactly the original delivery — no leaked re-fan
  }, 30_000);
});
