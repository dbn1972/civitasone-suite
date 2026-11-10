import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";

/**
 * UAT B24 group 3 (audit trail latency): pollTopic handled a received batch strictly one message
 * at a time, awaiting a DeleteMessage round trip after each. Where one SQS call costs seconds
 * (the UAT host: LocalStack answers every call in ~4.5 s), a batch of 10 cost ~50 s of deletes
 * alone, which capped the audit consumer at ~14 events/minute whatever the load.
 *
 * The acknowledgement of the successfully handled messages of one batch must overlap: handlers
 * still run one after another (per-tenant ordering, the audit hash chain), and each message is
 * still deleted only after its handler and its outcome record completed.
 */

const { stats } = vi.hoisted(() => ({
  stats: { deletes: 0, inFlight: 0, maxInFlight: 0, batchServed: false, handledBeforeDelete: true, handled: 0, bodies: [] as string[] },
}));

vi.mock("@aws-sdk/client-sqs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@aws-sdk/client-sqs")>();
  class FakeSQSClient {
    async send(cmd: { constructor: { name: string }; input: Record<string, unknown> }) {
      switch (cmd.constructor.name) {
        case "GetQueueUrlCommand":
          return { QueueUrl: `https://sqs.test/${String(cmd.input.QueueName)}` };
        case "GetQueueAttributesCommand":
          return { Attributes: { QueueArn: "arn:aws:sqs:ap-south-1:000000000000:fake-dlq" } };
        case "ReceiveMessageCommand": {
          if (stats.batchServed) { await new Promise((r) => setTimeout(r, 15)); return { Messages: [] }; }
          stats.batchServed = true;
          return {
            Messages: stats.bodies.map((Body, i) => ({
              Body, ReceiptHandle: `rh-${i}`, Attributes: { ApproximateReceiveCount: "1" },
            })),
          };
        }
        case "DeleteMessageCommand": {
          stats.inFlight += 1;
          stats.maxInFlight = Math.max(stats.maxInFlight, stats.inFlight);
          if (stats.handled < stats.bodies.length && stats.deletes === 0) stats.handledBeforeDelete = stats.handled >= 1;
          await new Promise((r) => setTimeout(r, 40)); // one slow SQS round trip
          stats.inFlight -= 1;
          stats.deletes += 1;
          return {};
        }
        default:
          return {};
      }
    }
  }
  return { ...actual, SQSClient: FakeSQSClient };
});

import { vi } from "vitest";

describe("SqsQueue.pollTopic batch acknowledgement (UAT B24)", () => {
  it("deletes the handled messages of one received batch concurrently, after every handler ran in order", async () => {
    const { SqsQueue } = await import("../src/bus.js");
    const topic = `qtest.batch.${randomUUID().slice(0, 8)}`;
    const tenantId = randomUUID();
    const ids = Array.from({ length: 10 }, () => randomUUID());
    stats.bodies = ids.map((messageId) => JSON.stringify({
      messageId, type: topic, tenantId, actorId: "actor-1", correlationId: randomUUID(),
      timestamp: new Date().toISOString(), schemaVersion: "1.0", payload: {},
    }));

    const order: string[] = [];
    const queue = new SqsQueue();
    queue.subscribe(topic, async (m: { messageId: string }) => { order.push(m.messageId); stats.handled += 1; });
    await queue.start();
    const deadline = Date.now() + 5000;
    while (stats.deletes < ids.length && Date.now() < deadline) await new Promise((r) => setTimeout(r, 10));
    await queue.stop();

    expect(stats.deletes).toBe(ids.length);
    expect(order).toEqual(ids); // handlers stay serial and in receive order
    expect(stats.maxInFlight).toBeGreaterThan(1); // deletes overlap instead of 10 sequential round trips
  }, 15_000);
});
