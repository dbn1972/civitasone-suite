import { describe, it, expect, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { RabbitMqQueue } from "../src/adapters/rabbitmq.js";
import { deriveTraceparent, type CommandEnvelope } from "../src/bus.js";

/**
 * PERF-008: RabbitMqQueue has its OWN private envelope() method (a
 * pre-existing, separate copy from bus.ts's — see rabbitmq.ts's own comment
 * on why: this fleet's outbox/index.ts header already documents that
 * "copy-pasted... and already diverging" is a known risk class for this
 * codebase). This fix made that copy call the SAME shared deriveTraceparent()
 * bus.ts uses, rather than re-implementing the derivation a second time.
 * This test proves that wiring is real — a message actually delivered
 * through a real RabbitMQ broker carries the same traceparent shape/
 * derivation as MemoryQueue's (see perf-008-traceparent.test.ts), not just
 * that the two files happen to typecheck.
 *
 * GATED on RABBITMQ_URL, same skip-cleanly convention as
 * perf-017-rabbitmq-backoff.test.ts / sqs.localstack.test.ts.
 */
const rabbitUrl = process.env.RABBITMQ_URL;
const TRACEPARENT_RE = /^[0-9a-f]{2}-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$/;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// FLAKY-SKIP: Requires a real RabbitMQ (RABBITMQ_URL); unset in standard CI so this suite never executes there. (expires: 2026-12-13)
describe.skipIf(!rabbitUrl)("RabbitMqQueue traceparent ↔ real RabbitMQ (PERF-008)", () => {
  let queue: RabbitMqQueue;

  afterEach(async () => {
    if (queue) await queue.stop();
  });

  it("a message delivered through a real broker carries a valid traceparent derived from correlationId", async () => {
    const topic = `qtest.traceparent.${randomUUID().slice(0, 8)}`;
    const correlationId = randomUUID();
    let received: CommandEnvelope | undefined;

    queue = new RabbitMqQueue();
    queue.subscribe(topic, async (msg) => { received = msg; });
    await queue.start();
    await queue.publish(topic, {
      type: topic,
      tenantId: "tenant-1",
      actorId: "actor-1",
      correlationId,
      schemaVersion: "1.0",
      payload: {},
    });

    const deadline = Date.now() + 10_000;
    while (!received && Date.now() < deadline) await sleep(50);

    expect(received).toBeDefined();
    expect(received!.traceparent).toMatch(TRACEPARENT_RE);
    expect(received!.traceparent.split("-")[1]).toBe(deriveTraceparent(correlationId).split("-")[1]);
  }, 15_000);
});
