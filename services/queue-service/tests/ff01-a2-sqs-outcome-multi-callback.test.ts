import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { randomUUID } from "node:crypto";

/**
 * PR-FF01-A2 (FF-01 §2.1 C2, invariant I2): two regressions on the SqsQueue
 * driver's command-outcome path.
 *
 *   1. Multiple onOutcome handlers per topic. The SqsQueue stored a single
 *      onOutcome callback per topic (bus.ts topicOutcomeCallbacks as
 *      Map<string, onOutcome>), so a SECOND subscribe() on the same topic
 *      silently replaced the first subscriber's onOutcome. Both subscribers'
 *      handlers already ran (handlers is Map<string, Handler[]>), but only the
 *      last-registered onOutcome ever fired — the first command-result write
 *      was lost. The fix keeps a LIST of onOutcome callbacks per topic and
 *      invokes all of them for every terminal outcome.
 *
 *   2. Result durable BEFORE delete (I2). The terminal outcome must be recorded
 *      before the SQS message is deleted / dead-lettered, so a lost result
 *      cannot be hidden behind an already-removed message. The fix emits the
 *      outcome before DeleteMessageCommand on all three terminal paths
 *      (succeeded / rejected / failed).
 *
 * Single-subscriber behaviour is unchanged — the existing
 * g-async-1-sqs-outcome.test.ts continues to assert the one-callback case.
 *
 * Same fully-mocked-SQS-client pattern as g-async-1-sqs-outcome.test.ts /
 * perf-004-dlq-backoff.test.ts: a fake client records every command in order,
 * so the test can assert the EXACT sequence (outcome callback vs DeleteMessage)
 * rather than inferring from timing.
 */

const { sent, order, state } = vi.hoisted(() => ({
  sent: [] as Array<{ name: string; input: Record<string, unknown> }>,
  // Chronological trace of the events we care about, to assert ordering.
  order: [] as string[],
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
          order.push("delete");
          state.delivered = true;
          return {};
        case "SendMessageCommand":
          if (String(cmd.input.QueueUrl).endsWith("-dlq")) order.push("dlq");
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

function dlqSend() {
  return sent.find((c) => c.name === "SendMessageCommand" && String(c.input.QueueUrl).endsWith("-dlq"));
}

async function waitForDelivery(timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!state.delivered && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 10));
  }
}

describe("SqsQueue onOutcome: multiple callbacks + durable-before-delete (PR-FF01-A2)", () => {
  beforeEach(async () => {
    sent.length = 0;
    order.length = 0;
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

  it("invokes BOTH subscribers' onOutcome on a topic (a second subscribe no longer replaces the first)", async () => {
    const { SqsQueue } = await import("../src/bus.js");
    type Outcome = { messageId: string; tenantId: string; topic: string; status: string; reason?: string };
    const first: Outcome[] = [];
    const second: Outcome[] = [];

    const topic = `qtest.multi.${randomUUID().slice(0, 8)}`;
    const messageId = randomUUID();
    const tenantId = randomUUID();
    state.body = envelope(topic, messageId, tenantId);

    const queue = new SqsQueue();
    queue.subscribe(topic, async () => { /* succeeds */ }, {
      onOutcome: (o) => { first.push(o); },
    });
    queue.subscribe(topic, async () => { /* succeeds */ }, {
      onOutcome: (o) => { second.push(o); },
    });
    await queue.start();
    await waitForDelivery();
    await queue.stop();

    expect(state.delivered).toBe(true);
    // Before the fix the first subscriber's onOutcome was overwritten and never
    // fired; now BOTH receive the terminal outcome exactly once.
    expect(first).toHaveLength(1);
    expect(second).toHaveLength(1);
    expect(first[0]).toMatchObject({ messageId, tenantId, topic, status: "succeeded" });
    expect(second[0]).toMatchObject({ messageId, tenantId, topic, status: "succeeded" });
    expect(dlqSend()).toBeUndefined();
  }, 15_000);

  it("records the outcome BEFORE deleting the message on the success path (durable before delete, I2)", async () => {
    const { SqsQueue } = await import("../src/bus.js");

    const topic = `qtest.durable.${randomUUID().slice(0, 8)}`;
    const messageId = randomUUID();
    const tenantId = randomUUID();
    state.body = envelope(topic, messageId, tenantId);

    const queue = new SqsQueue();
    queue.subscribe(topic, async () => { /* succeeds */ }, {
      onOutcome: () => { order.push("outcome"); },
    });
    await queue.start();
    await waitForDelivery();
    await queue.stop();

    expect(state.delivered).toBe(true);
    // The outcome callback must run strictly before the SQS DeleteMessage.
    expect(order).toContain("outcome");
    expect(order).toContain("delete");
    expect(order.indexOf("outcome")).toBeLessThan(order.indexOf("delete"));
  }, 15_000);

  it("records a rejected outcome BEFORE the delete on the NonRetryableError path (durable before delete, I2)", async () => {
    const { SqsQueue, NonRetryableError } = await import("../src/bus.js");

    const topic = `qtest.reject-durable.${randomUUID().slice(0, 8)}`;
    const messageId = randomUUID();
    const tenantId = randomUUID();
    state.body = envelope(topic, messageId, tenantId);

    const queue = new SqsQueue();
    queue.subscribe(topic, async () => {
      throw new NonRetryableError("OVER_APPROPRIATION: head exhausted");
    }, { onOutcome: () => { order.push("outcome"); } });
    await queue.start();
    await waitForDelivery();
    await queue.stop();

    expect(state.delivered).toBe(true);
    expect(dlqSend()).toBeDefined();
    expect(order).toContain("outcome");
    expect(order).toContain("delete");
    // The rejected result is durable before the message is removed.
    expect(order.indexOf("outcome")).toBeLessThan(order.indexOf("delete"));
  }, 15_000);

  it("records a failed outcome BEFORE the delete once retries are exhausted (durable before delete, I2)", async () => {
    const { SqsQueue } = await import("../src/bus.js");

    const topic = `qtest.fail-durable.${randomUUID().slice(0, 8)}`;
    const messageId = randomUUID();
    const tenantId = randomUUID();
    state.body = envelope(topic, messageId, tenantId);

    const queue = new SqsQueue();
    queue.subscribe(topic, async () => {
      throw new Error("downstream unavailable");
    }, { onOutcome: () => { order.push("outcome"); } });
    await queue.start();
    await waitForDelivery();
    await queue.stop();

    expect(state.delivered).toBe(true);
    expect(dlqSend()).toBeDefined();
    expect(order).toContain("outcome");
    expect(order).toContain("delete");
    expect(order.indexOf("outcome")).toBeLessThan(order.indexOf("delete"));
  }, 15_000);
});
