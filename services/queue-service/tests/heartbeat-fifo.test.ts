import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  recordConsumerHeartbeat,
  getLastConsumerHeartbeat,
  consumerHeartbeatCheck,
  resetConsumerHeartbeats,
} from "@civitasone/observability";

/**
 * 09-T4: consumer heartbeat → readiness.
 * record sets the last-poll time; the staleness check returns false when the
 * loop has not polled within the window (or has never polled).
 */
describe("consumer heartbeat → readiness (09-T4)", () => {
  beforeEach(() => resetConsumerHeartbeats());

  it("recordConsumerHeartbeat sets the last poll time", () => {
    expect(getLastConsumerHeartbeat("queue-service")).toBeNull();
    const before = Date.now();
    recordConsumerHeartbeat("queue-service");
    const last = getLastConsumerHeartbeat("queue-service");
    expect(last).not.toBeNull();
    expect(last as number).toBeGreaterThanOrEqual(before);
  });

  it("getLastConsumerHeartbeat() with no arg returns the most recent across services", () => {
    recordConsumerHeartbeat("a");
    const t = getLastConsumerHeartbeat();
    expect(t).not.toBeNull();
    expect(getLastConsumerHeartbeat("a")).toBe(t);
  });

  it("staleness check is true when fresh and false when never polled", () => {
    const check = consumerHeartbeatCheck({ maxStalenessMs: 1000, service: "queue-service" });
    expect(check()).toBe(false); // never polled
    recordConsumerHeartbeat("queue-service");
    expect(check()).toBe(true);
  });

  it("staleness check returns false once the heartbeat is older than the window", () => {
    vi.useFakeTimers();
    try {
      const check = consumerHeartbeatCheck({ maxStalenessMs: 1000, service: "queue-service" });
      recordConsumerHeartbeat("queue-service");
      expect(check()).toBe(true);
      vi.advanceTimersByTime(2000); // poll loop went quiet for 2s > 1s window
      expect(check()).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});

// ── 05-T4: FIFO publish wiring against a mocked SQS client ───────────────────

const { sent } = vi.hoisted(() => ({ sent: [] as Array<{ name: string; input: Record<string, unknown> }> }));

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
          return { Attributes: { QueueArn: "arn:aws:sqs:ap-south-1:000:dlq" } };
        case "ListQueuesCommand": {
          // QUE-FANOUT: publish() discovers each subscriber's per-topic queue via
          // ListQueues(prefix) and fans a copy out to every one. Return one
          // subscriber queue matching the requested prefix so a send is emitted.
          const prefix = String(cmd.input.QueueNamePrefix ?? "");
          return { QueueUrls: [`https://sqs.test/${prefix}testsvc`] };
        }
        default:
          return {};
      }
    }
  }
  return { ...actual, SQSClient: FakeSQSClient };
});

const baseInput = {
  type: "finance.gl.post",
  tenantId: "tenant-1",
  actorId: "actor-1",
  correlationId: "corr-1",
  schemaVersion: "1.0",
  payload: { amount: 100 },
};

describe("FIFO publish wiring (05-T4)", () => {
  beforeEach(() => { sent.length = 0; });
  afterEach(() => { delete process.env.QUEUE_DRIVER; });

  async function newSqsQueue() {
    const { SqsQueue } = await import("../src/bus.js");
    return new SqsQueue();
  }

  it("publishing to a `.fifo` topic sets MessageGroupId (tenantId) and MessageDeduplicationId (messageId)", async () => {
    const q = await newSqsQueue();
    const messageId = await q.publish("finance.gl.post.fifo", baseInput);

    const send = sent.find((c) => c.name === "SendMessageCommand");
    expect(send).toBeDefined();
    expect(send?.input.MessageGroupId).toBe("tenant-1");
    expect(send?.input.MessageDeduplicationId).toBe(messageId);

    // Fan-out targets the subscriber's own per-topic FIFO queue (discovered via
    // ListQueues), so the resolved queue prefix carries the topic base name.
    const list = sent.find((c) => c.name === "ListQueuesCommand");
    expect(String(list?.input.QueueNamePrefix)).toMatch(/^finance-gl-post__/);
  });

  it("publishing to a standard topic does NOT set FIFO attributes (default unchanged)", async () => {
    const q = await newSqsQueue();
    await q.publish("finance.gl.post", baseInput);

    const send = sent.find((c) => c.name === "SendMessageCommand");
    expect(send).toBeDefined();
    expect(send?.input.MessageGroupId).toBeUndefined();
    expect(send?.input.MessageDeduplicationId).toBeUndefined();
  });

  it("callers may override the message group (finer ordering scope)", async () => {
    const q = await newSqsQueue();
    await q.publish("finance.gl.post.fifo", baseInput, { messageGroupId: "tenant-1:acct-42" });

    const send = sent.find((c) => c.name === "SendMessageCommand");
    expect(send?.input.MessageGroupId).toBe("tenant-1:acct-42");
  });
});
