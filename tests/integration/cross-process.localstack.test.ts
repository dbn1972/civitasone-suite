/**
 * 10-T2 — Cross-PROCESS delivery proof (LocalStack-gated).
 *
 * The in-process chain tests (finance-chains.test.ts) prove the producer→consumer
 * wiring with one shared MemoryQueue. This test proves the OTHER half: that the
 * real SQS-backed bus actually carries a message from one process boundary to a
 * separate consumer instance. We publish via one `SqsQueue` and assert a
 * subscriber on a SECOND, independent `SqsQueue` instance receives it.
 *
 * It is gated on AWS_ENDPOINT_URL (LocalStack), so it SKIPS cleanly in CI where
 * no broker is running. To run locally:
 *   AWS_ENDPOINT_URL=http://localhost:4566 QUEUE_DRIVER=sqs \
 *     pnpm vitest run tests/integration/cross-process.localstack.test.ts
 */
import { describe, it, expect } from "vitest";
import { SqsQueue } from "../../packages/queue/dist/index.js";
import type { CommandEnvelope } from "../../packages/queue/dist/index.js";

const localstackUp = Boolean(process.env.AWS_ENDPOINT_URL);
const TOPIC = "test.crossprocess.ping";

describe.skipIf(!localstackUp)("Cross-process SQS delivery (LocalStack)", () => {
  it("a message published by one SqsQueue is received by a separate SqsQueue instance", async () => {
    // Two independent bus instances == two separate "processes" sharing a broker.
    const producer = new SqsQueue();
    const consumer = new SqsQueue();

    const received = new Promise<CommandEnvelope>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("timed out waiting for cross-process delivery")), 30_000);
      consumer.subscribe(TOPIC, async (msg) => {
        clearTimeout(timer);
        resolve(msg);
      });
    });
    await consumer.start();

    const correlationId = `xproc-${Date.now()}`;
    await producer.publish(TOPIC, {
      type: TOPIC,
      tenantId: "11111111-aaaa-4000-8000-000000000001",
      actorId: "22222222-bbbb-4000-8000-000000000001",
      correlationId,
      schemaVersion: "1.0",
      payload: { hello: "world" },
    });

    const msg = await received;
    expect(msg.correlationId).toBe(correlationId);
    expect((msg.payload as { hello: string }).hello).toBe("world");

    await consumer.stop();
  }, 35_000);
});
