import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { SqsQueue, type CommandEnvelope } from "../src/bus.js";
import { getDlqMessageCount, resetFailureMetrics } from "@civitasone/observability";

/**
 * 05-T5: real-SqsQueue integration against LocalStack.
 *
 * GATED on AWS_ENDPOINT_URL — exactly like the identity/finance perf tests are
 * gated on DB_URL. With no LocalStack this whole suite SKIPS cleanly in CI; set
 * AWS_ENDPOINT_URL (e.g. http://localhost:4566) to run it:
 *
 *   AWS_ENDPOINT_URL=http://localhost:4566 \
 *   QUEUE_DRIVER=sqs AWS_DEFAULT_REGION=ap-south-1 \
 *   pnpm --filter @civitasone/queue-service test
 */
const endpoint = process.env.AWS_ENDPOINT_URL;

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

describe.skipIf(!endpoint)("SqsQueue ↔ LocalStack (05-T5)", () => {
  let queue: SqsQueue;

  beforeAll(() => {
    // Fast redelivery so the dead-letter path is exercised within the test.
    process.env.SQS_MAX_RECEIVE_COUNT = "2";
    process.env.SQS_VISIBILITY_TIMEOUT = "1";
    process.env.AWS_DEFAULT_REGION = process.env.AWS_DEFAULT_REGION ?? "ap-south-1";
  });

  beforeEach(() => {
    resetFailureMetrics();
  });

  afterAll(async () => {
    if (queue) await queue.stop();
  });

  it("happy path: publish → poll → handler receives → delete", async () => {
    const topic = `qtest.happy.${randomUUID().slice(0, 8)}`;
    const received: CommandEnvelope[] = [];
    queue = new SqsQueue();
    queue.subscribe(topic, async (msg) => { received.push(msg); });
    await queue.start();

    const messageId = await queue.publish(topic, publishInput(topic));

    // poll loop uses 20s long-poll; give it time to receive + ack.
    for (let i = 0; i < 30 && received.length === 0; i++) await sleep(1000);

    expect(received.length).toBe(1);
    expect(received[0]?.messageId).toBe(messageId);
    await queue.stop();
  }, 60_000);

  it("a handler that throws dead-letters after maxReceiveCount", async () => {
    const topic = `qtest.poison.${randomUUID().slice(0, 8)}`;
    let calls = 0;
    queue = new SqsQueue();
    queue.subscribe(topic, async () => { calls++; throw new Error("always fails"); });
    await queue.start();

    await queue.publish(topic, publishInput(topic));

    // Wait for redelivery (visibility timeout 1s) to exhaust maxReceiveCount=2.
    for (let i = 0; i < 30 && getDlqMessageCount(topic) === 0; i++) await sleep(1000);

    expect(calls).toBeGreaterThanOrEqual(2);
    expect(getDlqMessageCount(topic)).toBeGreaterThanOrEqual(1);
    await queue.stop();
  }, 60_000);

  it("duplicate delivery applies once via a consumer idempotency set (_inbox/seen)", async () => {
    const topic = `qtest.dedup.${randomUUID().slice(0, 8)}`;
    const seen = new Set<string>(); // stands in for _inbox.processed
    let applied = 0;
    queue = new SqsQueue();
    queue.subscribe(topic, async (msg) => {
      if (seen.has(msg.messageId)) return; // idempotent: duplicate is a no-op
      seen.add(msg.messageId);
      applied++;
    });
    await queue.start();

    // Same messageId published twice → at-least-once may deliver both.
    const input = { ...publishInput(topic), messageId: randomUUID() };
    await queue.publish(topic, input);
    await queue.publish(topic, input);

    for (let i = 0; i < 20 && applied === 0; i++) await sleep(1000);
    await sleep(3000); // let any duplicate arrive

    expect(applied).toBe(1);
    await queue.stop();
  }, 60_000);
});
