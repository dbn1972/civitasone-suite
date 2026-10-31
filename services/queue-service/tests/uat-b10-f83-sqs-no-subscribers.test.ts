import { describe, it, expect, vi, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";

/**
 * UAT B10-F83 (bus half). Live UAT lost 6,500+ audit events on 2026-10-28/29:
 *  1. 16:00-18:01 the audit consumer's queue did not exist, so publish() found
 *     no subscriber queue and resolved anyway; the relay marked the rows
 *     published (276 `queue_publish_no_subscribers` for audit.event.record).
 *  2. LocalStack restarted at 2026-10-29 15:01 and came back with no queues;
 *     a consumer only got its queue back when its process was restarted,
 *     because pollTopic kept polling the cached, dead URL.
 *
 * Fully mocked SQS client (same pattern as g-async-1-sqs-outcome.test.ts).
 */
const { sent, state } = vi.hoisted(() => ({
  sent: [] as Array<{ name: string; input: Record<string, unknown> }>,
  state: {
    listed: [] as string[],
    exists: new Set<string>(),
    wipeOnFirstReceive: false,
    receives: 0,
    body: "",
    delivered: false,
  },
}));

vi.mock("@aws-sdk/client-sqs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@aws-sdk/client-sqs")>();
  const missing = () => Object.assign(new Error("The specified queue does not exist."), { name: "QueueDoesNotExist" });
  class FakeSQSClient {
    async send(cmd: { constructor: { name: string }; input: Record<string, unknown> }) {
      const name = cmd.constructor.name;
      sent.push({ name, input: cmd.input });
      const qn = String(cmd.input.QueueName ?? "");
      switch (name) {
        case "ListQueuesCommand":
          return { QueueUrls: state.listed };
        case "GetQueueUrlCommand":
          if (!state.exists.has(qn)) throw missing();
          return { QueueUrl: `https://sqs.test/${qn}` };
        case "CreateQueueCommand":
          state.exists.add(qn);
          return {};
        case "GetQueueAttributesCommand":
          return { Attributes: { QueueArn: "arn:aws:sqs:ap-south-1:000000000000:fake-dlq" } };
        case "ReceiveMessageCommand": {
          const qname = String(cmd.input.QueueUrl).split("/").pop()!;
          state.receives += 1;
          if (state.wipeOnFirstReceive) {
            state.wipeOnFirstReceive = false;
            state.exists.clear(); // the broker restarted and lost every queue
          }
          if (!state.exists.has(qname)) throw missing();
          if (state.delivered) { await new Promise((r) => setTimeout(r, 10)); return { Messages: [] }; }
          return { Messages: [{ Body: state.body, ReceiptHandle: "rh-1", Attributes: { ApproximateReceiveCount: "1" } }] };
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

beforeEach(() => {
  sent.length = 0;
  state.listed = [];
  state.exists = new Set();
  state.wipeOnFirstReceive = false;
  state.receives = 0;
  state.delivered = false;
  process.env.SERVICE_NAME = "audit-service";
});

const input = () => ({
  messageId: randomUUID(), type: "audit.event.record", tenantId: randomUUID(), actorId: randomUUID(),
  correlationId: randomUUID(), payload: { action: "approve", resourceType: "refund", resourceId: "r-1" },
});

describe("UAT B10-F83 SqsQueue.publish with no subscriber queue", () => {
  it("requireSubscribers: rejects with NoSubscribersError and sends nothing", async () => {
    const { SqsQueue, NoSubscribersError } = await import("../src/bus.js");
    const q = new SqsQueue();
    await expect(q.publish("audit.event.record", input(), { requireSubscribers: true })).rejects.toBeInstanceOf(NoSubscribersError);
    expect(sent.filter((c) => c.name === "SendMessageCommand")).toHaveLength(0);
  });

  it("requireSubscribers: re-lists on the next attempt and delivers once the queue exists", async () => {
    const { SqsQueue } = await import("../src/bus.js");
    const q = new SqsQueue();
    await expect(q.publish("audit.event.record", input(), { requireSubscribers: true })).rejects.toThrow(/no subscriber queue/);
    state.listed = ["https://sqs.test/audit-event-record__audit-service"];
    await expect(q.publish("audit.event.record", input(), { requireSubscribers: true })).resolves.toBeTypeOf("string");
    const sends = sent.filter((c) => c.name === "SendMessageCommand");
    expect(sends).toHaveLength(1);
    expect(sends[0]!.input.QueueUrl).toBe("https://sqs.test/audit-event-record__audit-service");
  });

  it("without the option keeps the existing fire-and-forget behaviour (resolves, logs)", async () => {
    const { SqsQueue } = await import("../src/bus.js");
    const q = new SqsQueue();
    await expect(q.publish("some.event", input())).resolves.toBeTypeOf("string");
  });
});

describe("UAT B10-F83 SqsQueue consumer after the broker loses its queue", () => {
  it("re-creates the queue and keeps consuming, without a process restart", async () => {
    const { SqsQueue } = await import("../src/bus.js");
    const topic = "audit.event.record";
    state.exists.add("audit-event-record__audit-service");
    state.exists.add("audit-event-record__audit-service-dlq");
    state.wipeOnFirstReceive = true;
    state.body = JSON.stringify({ ...input(), timestamp: new Date().toISOString(), schemaVersion: "1.0" });

    const handled: string[] = [];
    const q = new SqsQueue();
    q.subscribe(topic, async (m) => { handled.push(m.messageId); });
    await q.start();
    const deadline = Date.now() + 1500; // under the 2 s error back-off, so only the fix can pass
    while (!state.delivered && Date.now() < deadline) await new Promise((r) => setTimeout(r, 10));
    await q.stop();

    expect(sent.some((c) => c.name === "CreateQueueCommand" && c.input.QueueName === "audit-event-record__audit-service")).toBe(true);
    expect(handled).toHaveLength(1);
    expect(state.delivered).toBe(true);
  }, 15_000);
});

describe("isQueueMissingError", () => {
  it("recognises the SQS and LocalStack forms only", async () => {
    const { isQueueMissingError } = await import("../src/bus.js");
    expect(isQueueMissingError(Object.assign(new Error("x"), { name: "QueueDoesNotExist" }))).toBe(true);
    expect(isQueueMissingError({ Code: "AWS.SimpleQueueService.NonExistentQueue" })).toBe(true);
    expect(isQueueMissingError(new Error("The specified queue does not exist."))).toBe(true);
    expect(isQueueMissingError(new Error("socket hang up"))).toBe(false);
    expect(isQueueMissingError(undefined)).toBe(false);
  });
});
