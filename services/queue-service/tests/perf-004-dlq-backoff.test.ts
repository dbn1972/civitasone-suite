import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * PERF-004: SQS consumers had no retry backoff — a failed message was
 * redelivered immediately, repeatedly, at the queue's fixed default
 * VisibilityTimeout until SQS_MAX_RECEIVE_COUNT was hit. Separately,
 * routeToDlq() sent a poison message to the DLQ but emitted no counter/alert,
 * so DLQ arrivals were completely silent.
 *
 * This file covers:
 *  1. computeBackoffSeconds() — the pure exponential-backoff curve.
 *  2. A poison message: increasing ChangeMessageVisibility backoff, then DLQ
 *     with dlq_total incremented (asserted against a fully-mocked SQS client
 *     so the exact ChangeMessageVisibility calls/timeouts are observable,
 *     not just "eventually DLQ'd").
 *  3. A message that fails twice then succeeds: still processed exactly once
 *     (deleted once, no redelivery after success) despite the backoff delays
 *     in between — the backoff must not interact badly with at-least-once
 *     delivery/idempotent-consumer semantics.
 *  4. infra/observability/alert.rules.yml defines an alert on dlq_total whose
 *     trigger condition this file's own recorded DLQ arrival satisfies.
 */

// ── 1. Pure backoff curve ────────────────────────────────────────────────────

import {
  computeBackoffSeconds,
  resolveBackoffBaseSeconds,
  resolveBackoffMaxSeconds,
  DEFAULT_SQS_BACKOFF_BASE_SECONDS,
  DEFAULT_SQS_BACKOFF_MAX_SECONDS,
} from "../src/bus.js";

describe("computeBackoffSeconds (PERF-004 backoff curve)", () => {
  it("doubles per delivery attempt starting at the base, capped at the max", () => {
    const opts = { baseSeconds: 1, maxSeconds: 60 };
    expect(computeBackoffSeconds(1, opts)).toBe(1);
    expect(computeBackoffSeconds(2, opts)).toBe(2);
    expect(computeBackoffSeconds(3, opts)).toBe(4);
    expect(computeBackoffSeconds(4, opts)).toBe(8);
    expect(computeBackoffSeconds(5, opts)).toBe(16);
    expect(computeBackoffSeconds(6, opts)).toBe(32);
    expect(computeBackoffSeconds(7, opts)).toBe(60); // 64 → capped at 60
    expect(computeBackoffSeconds(20, opts)).toBe(60);
  });

  it("defaults to base=1s / max=60s per skill 07 when no override is set", () => {
    expect(resolveBackoffBaseSeconds(undefined)).toBe(DEFAULT_SQS_BACKOFF_BASE_SECONDS);
    expect(resolveBackoffMaxSeconds(undefined)).toBe(DEFAULT_SQS_BACKOFF_MAX_SECONDS);
    expect(DEFAULT_SQS_BACKOFF_BASE_SECONDS).toBe(1);
    expect(DEFAULT_SQS_BACKOFF_MAX_SECONDS).toBe(60);
  });

  it("falls back to the default on a malformed override instead of throwing", () => {
    expect(resolveBackoffBaseSeconds("not-a-number")).toBe(DEFAULT_SQS_BACKOFF_BASE_SECONDS);
    expect(resolveBackoffMaxSeconds("0")).toBe(DEFAULT_SQS_BACKOFF_MAX_SECONDS);
  });
});

// ── 2 & 3. Poison-message + retry-then-succeed, against a fully mocked SQS ──
// Same vi.mock("@aws-sdk/client-sqs", ...) pattern already used by
// heartbeat-fifo.test.ts (05-T4) — a fake client that records every command
// and its input, so ChangeMessageVisibility calls/timeouts are directly
// assertable instead of only inferring backoff from wall-clock timing.

const { sent, state } = vi.hoisted(() => ({
  sent: [] as Array<{ name: string; input: Record<string, unknown> }>,
  state: { receiveCount: 0, delivered: false, body: "" },
}));

vi.mock("@aws-sdk/client-sqs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@aws-sdk/client-sqs")>();
  class FakeSQSClient {
    async send(cmd: { constructor: { name: string }; input: Record<string, unknown> }) {
      const name = cmd.constructor.name;
      sent.push({ name, input: cmd.input });
      switch (name) {
        case "GetQueueUrlCommand":
          // Always resolve — this is the "queue already exists" fast path
          // (BOOT-FAST), so no CreateQueue/RedrivePolicy setup is exercised.
          return { QueueUrl: `https://sqs.test/${String(cmd.input.QueueName)}` };
        case "GetQueueAttributesCommand":
          return { Attributes: { QueueArn: "arn:aws:sqs:ap-south-1:000000000000:fake-dlq" } };
        case "ReceiveMessageCommand": {
          if (state.delivered) {
            // Idle poll after the message left the queue — yield briefly so
            // the test's own polling loop isn't starved by a tight spin.
            await new Promise((r) => setTimeout(r, 15));
            return { Messages: [] };
          }
          state.receiveCount += 1;
          return {
            Messages: [{
              Body: state.body,
              ReceiptHandle: `rh-${state.receiveCount}`,
              Attributes: { ApproximateReceiveCount: String(state.receiveCount) },
            }],
          };
        }
        case "DeleteMessageCommand":
          state.delivered = true;
          return {};
        default:
          return {};
      }
    }
  }
  return { ...actual, SQSClient: FakeSQSClient };
});

function poisonEnvelope(topic: string) {
  return JSON.stringify({
    messageId: randomUUID(),
    type: topic,
    tenantId: "tenant-1",
    actorId: "actor-1",
    correlationId: randomUUID(),
    timestamp: new Date().toISOString(),
    schemaVersion: "1.0",
    payload: { hello: "world" },
  });
}

function visibilityTimeouts(): number[] {
  return sent
    .filter((c) => c.name === "ChangeMessageVisibilityCommand")
    .map((c) => Number(c.input.VisibilityTimeout));
}

describe("poison message → backoff → DLQ (PERF-004)", () => {
  beforeEach(async () => {
    sent.length = 0;
    state.receiveCount = 0;
    state.delivered = false;
    process.env.SQS_MAX_RECEIVE_COUNT = "4";
    process.env.SQS_BACKOFF_BASE_SECONDS = "1";
    process.env.SQS_BACKOFF_MAX_SECONDS = "60";
    const { resetFailureMetrics } = await import("@civitasone/observability");
    resetFailureMetrics();
  });

  afterEach(() => {
    delete process.env.SQS_MAX_RECEIVE_COUNT;
    delete process.env.SQS_BACKOFF_BASE_SECONDS;
    delete process.env.SQS_BACKOFF_MAX_SECONDS;
  });

  it("a handler that always fails gets progressively increasing visibility-timeout backoff, then DLQs with dlq_total incremented", async () => {
    const { SqsQueue } = await import("../src/bus.js");
    const { getDlqMessageCount } = await import("@civitasone/observability");

    const topic = `qtest.poison.${randomUUID().slice(0, 8)}`;
    state.body = poisonEnvelope(topic);

    let calls = 0;
    const queue = new SqsQueue();
    queue.subscribe(topic, async () => { calls++; throw new Error("always fails"); });
    await queue.start();

    const deadline = Date.now() + 5000;
    while (!state.delivered && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 10));
    }
    await queue.stop();

    expect(state.delivered).toBe(true);
    expect(calls).toBe(4); // == SQS_MAX_RECEIVE_COUNT

    // The core PERF-004 assertion: the ACTUAL ChangeMessageVisibility calls
    // issued for attempts 1-3 (attempt 4 goes straight to the DLQ, no further
    // visibility change), with progressively increasing timeouts — not a
    // fixed rate.
    const timeouts = visibilityTimeouts();
    expect(timeouts).toEqual([1, 2, 4]);
    for (let i = 1; i < timeouts.length; i++) {
      expect(timeouts[i]).toBeGreaterThan(timeouts[i - 1]);
    }

    // Eventually DLQ'd with dlq_total{topic, reason} incremented.
    expect(getDlqMessageCount(topic, "max_receive_count_exceeded")).toBe(1);

    const dlqSend = sent.find(
      (c) => c.name === "SendMessageCommand" && String(c.input.QueueUrl).endsWith("-dlq"),
    );
    expect(dlqSend).toBeDefined();
  }, 15_000);

  it("a message that fails twice then succeeds is redelivered with backoff but processed exactly once", async () => {
    const { SqsQueue } = await import("../src/bus.js");

    const topic = `qtest.retry-success.${randomUUID().slice(0, 8)}`;
    state.body = poisonEnvelope(topic);

    let attempts = 0;
    let successes = 0;
    const queue = new SqsQueue();
    queue.subscribe(topic, async () => {
      attempts += 1;
      if (attempts < 3) throw new Error("transient failure");
      successes += 1;
    });
    await queue.start();

    const deadline = Date.now() + 5000;
    while (!state.delivered && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 10));
    }
    // Give the poll loop a further moment to prove it does NOT redeliver
    // again after the successful delete (outbox/idempotency discipline: a
    // message that succeeds after backoff must be marked done exactly once).
    await new Promise((r) => setTimeout(r, 100));
    await queue.stop();

    expect(attempts).toBe(3);
    expect(successes).toBe(1);

    const timeouts = visibilityTimeouts();
    expect(timeouts).toEqual([1, 2]); // backoff only for the 2 failed attempts

    const deletes = sent.filter((c) => c.name === "DeleteMessageCommand");
    expect(deletes.length).toBe(1); // deleted exactly once, right after success

    const dlqSend = sent.find(
      (c) => c.name === "SendMessageCommand" && String(c.input.QueueUrl).endsWith("-dlq"),
    );
    expect(dlqSend).toBeUndefined(); // never dead-lettered — it succeeded
  }, 15_000);
});

// ── 4. dlq_total alert rule ──────────────────────────────────────────────────

describe("dlq_total alert rule (PERF-004)", () => {
  it("alert.rules.yml defines an alert on dlq_total whose threshold this file's own recorded DLQ arrival would cross", async () => {
    const { resetFailureMetrics, incrementDlqMessage, getDlqMessageCount } =
      await import("@civitasone/observability");

    const rulesPath = fileURLToPath(
      new URL("../../../infra/observability/alert.rules.yml", import.meta.url),
    );
    const rulesText = readFileSync(rulesPath, "utf8");

    const ruleMatch = rulesText.match(/- alert: DlqMessagesAppearing[\s\S]*?expr:\s*(.+)\r?\n/);
    expect(ruleMatch, "DlqMessagesAppearing alert not found in infra/observability/alert.rules.yml").not.toBeNull();

    const expr = ruleMatch![1];
    expect(expr).toMatch(/dlq_total/);

    const thresholdMatch = expr.match(/>\s*(\d+)/);
    expect(thresholdMatch, `no numeric threshold found in expr: ${expr}`).not.toBeNull();
    const threshold = Number(thresholdMatch![1]);

    // This is the same counter routeToDlq() increments in bus.ts. Recording a
    // real arrival here and checking it against the rule's own threshold is
    // the testable interface available for a Prometheus/Alertmanager rule —
    // we can't fire a live page in a unit test, but we CAN prove the
    // condition the rule evaluates would be satisfied.
    resetFailureMetrics();
    incrementDlqMessage("perf-004-alert-check-topic", "max_receive_count_exceeded");
    const count = getDlqMessageCount("perf-004-alert-check-topic", "max_receive_count_exceeded");
    expect(count).toBeGreaterThan(threshold);
  });
});
