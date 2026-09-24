import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { randomUUID } from "node:crypto";

/**
 * G-ASYNC-1: SubscribeOptions.onOutcome, exercised through the ACTUAL
 * SqsQueue.pollTopic path — not just MemoryQueue.
 *
 * MemoryQueue.deliver() and SqsQueue.pollTopic() are two independent
 * implementations of the same three-way outcome split (succeeded /
 * NonRetryableError-rejected / retries-exhausted-failed); MemoryQueue is what
 * every service's own test suite runs against (see e.g.
 * tender-lifecycle.test.ts, approval-consumer.test.ts), but SqsQueue is what
 * actually runs in production (QUEUE_DRIVER=sqs). Before this file, nothing
 * in the fleet asserted that onOutcome fires correctly on the SqsQueue side
 * at all — a bug isolated to pollTopic's emitOutcome() calls (wrong status,
 * wrong reason, called twice, or never called) would have shipped invisibly:
 * every MemoryQueue-backed test would stay green.
 *
 * Same fully-mocked-SQS-client pattern as perf-004-dlq-backoff.test.ts (and
 * heartbeat-fifo.test.ts before it) — a fake client that records every
 * command and its input, so this can assert the EXACT sequence of calls
 * (ChangeMessageVisibility count, DeleteMessage, DLQ SendMessage) rather than
 * only inferring behaviour from wall-clock timing or real AWS/LocalStack.
 */

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
          // BOOT-FAST "queue already exists" path — no CreateQueue/RedrivePolicy setup.
          return { QueueUrl: `https://sqs.test/${String(cmd.input.QueueName)}` };
        case "GetQueueAttributesCommand":
          return { Attributes: { QueueArn: "arn:aws:sqs:ap-south-1:000000000000:fake-dlq" } };
        case "ReceiveMessageCommand": {
          if (state.delivered) {
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

function envelope(topic: string, messageId: string, tenantId: string) {
  return JSON.stringify({
    messageId, type: topic, tenantId, actorId: "actor-1",
    correlationId: randomUUID(), timestamp: new Date().toISOString(),
    schemaVersion: "1.0", payload: { hello: "world" },
  });
}

function changeVisibilityCalls(): number {
  return sent.filter((c) => c.name === "ChangeMessageVisibilityCommand").length;
}

function dlqSend() {
  return sent.find((c) => c.name === "SendMessageCommand" && String(c.input.QueueUrl).endsWith("-dlq"));
}

async function waitForDelivery(timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!state.delivered && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 10));
  }
}

describe("SqsQueue.pollTopic + onOutcome (G-ASYNC-1)", () => {
  beforeEach(async () => {
    sent.length = 0;
    state.receiveCount = 0;
    state.delivered = false;
    process.env.SQS_MAX_RECEIVE_COUNT = "2";
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

  it("succeeded: onOutcome fires exactly once with status 'succeeded' after the handler resolves", async () => {
    const { SqsQueue } = await import("../src/bus.js");
    type Outcome = { messageId: string; tenantId: string; topic: string; status: string; reason?: string };
    const outcomes: Outcome[] = [];

    const topic = `qtest.succeed.${randomUUID().slice(0, 8)}`;
    const messageId = randomUUID();
    const tenantId = randomUUID();
    state.body = envelope(topic, messageId, tenantId);

    const queue = new SqsQueue();
    queue.subscribe(topic, async () => { /* succeeds */ }, {
      onOutcome: (o) => { outcomes.push(o); },
    });
    await queue.start();
    await waitForDelivery();
    await queue.stop();

    expect(state.delivered).toBe(true);
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]).toMatchObject({ messageId, tenantId, topic, status: "succeeded" });
    expect(outcomes[0].reason).toBeUndefined();
    expect(dlqSend()).toBeUndefined();
  }, 15_000);

  it("rejected: a NonRetryableError dead-letters immediately (no backoff retries) and onOutcome fires once with status 'rejected' and the error message as reason", async () => {
    const { SqsQueue, NonRetryableError } = await import("../src/bus.js");
    type Outcome = { messageId: string; tenantId: string; topic: string; status: string; reason?: string };
    const outcomes: Outcome[] = [];

    const topic = `qtest.reject.${randomUUID().slice(0, 8)}`;
    const messageId = randomUUID();
    const tenantId = randomUUID();
    state.body = envelope(topic, messageId, tenantId);

    let calls = 0;
    const queue = new SqsQueue();
    queue.subscribe(topic, async () => {
      calls += 1;
      throw new NonRetryableError("MAKER_CHECKER_VIOLATION: the submitter cannot approve their own template");
    }, { onOutcome: (o) => { outcomes.push(o); } });
    await queue.start();
    await waitForDelivery();
    await queue.stop();

    expect(state.delivered).toBe(true);
    expect(calls).toBe(1); // NonRetryableError bypasses the retry loop entirely
    expect(changeVisibilityCalls()).toBe(0); // never backed off — straight to DLQ
    expect(dlqSend()).toBeDefined();

    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]).toMatchObject({ messageId, tenantId, topic, status: "rejected" });
    expect(outcomes[0].reason).toContain("MAKER_CHECKER_VIOLATION");
  }, 15_000);

  it("failed: a handler that always throws a RETRYABLE error backs off, exhausts SQS_MAX_RECEIVE_COUNT, and onOutcome fires exactly once (not per attempt) with status 'failed' and the last attempt's error as reason", async () => {
    const { SqsQueue } = await import("../src/bus.js");
    type Outcome = { messageId: string; tenantId: string; topic: string; status: string; reason?: string };
    const outcomes: Outcome[] = [];

    const topic = `qtest.fail.${randomUUID().slice(0, 8)}`;
    const messageId = randomUUID();
    const tenantId = randomUUID();
    state.body = envelope(topic, messageId, tenantId);

    let calls = 0;
    const queue = new SqsQueue();
    queue.subscribe(topic, async () => {
      calls += 1;
      throw new Error(`downstream unavailable (attempt ${calls})`);
    }, { onOutcome: (o) => { outcomes.push(o); } });
    await queue.start();
    await waitForDelivery();
    await queue.stop();

    expect(state.delivered).toBe(true);
    expect(calls).toBe(2); // == SQS_MAX_RECEIVE_COUNT set in beforeEach
    expect(dlqSend()).toBeDefined();

    // Exactly one outcome — NOT one per failed attempt. A naive implementation
    // that emitted on every catch (instead of only once the retry budget is
    // actually exhausted) would fail this specific assertion.
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]).toMatchObject({ messageId, tenantId, topic, status: "failed" });
    // The LAST attempt's message (attempt 2), not the first — proves lastError
    // tracking survives across the redelivery, not just the first catch.
    expect(outcomes[0].reason).toBe("downstream unavailable (attempt 2)");
  }, 15_000);
});
