/**
 * Invariant test: H11 — Consumers must not swallow errors (ACK-and-drop).
 *
 * PROPERTY: A consumer handler that throws does NOT delete the message.
 * The message must redeliver (visibility timeout) or go to DLQ after maxReceiveCount.
 * catch(err) { log.error() } without rethrow = message silently vanishes = data loss.
 *
 * This test verifies the MemoryQueue behavior: a thrown error routes to DLQ.
 */
import { describe, it, expect } from "vitest";
import { MemoryQueue, NonRetryableError } from "../../services/queue-service/src/bus.js";

describe("H11 — Consumer error propagation (no swallow)", () => {
  it("a handler that throws goes to DLQ (not silently ACKed)", async () => {
    const queue = new MemoryQueue({ maxAttempts: 1 });

    queue.subscribe("test.topic", async () => {
      throw new Error("handler failure — must NOT be swallowed");
    });

    await queue.start();
    await queue.publish("test.topic", {
      type: "test.topic",
      tenantId: "t1",
      actorId: "a1",
      correlationId: "c1",
      schemaVersion: "1",
      payload: {},
    });

    // Wait for async delivery
    await new Promise((r) => setTimeout(r, 100));

    // The message MUST be in the DLQ (not silently deleted)
    expect(queue.dlq.length).toBe(1);
    expect(queue.dlq[0]!.error).toContain("handler failure");
  });

  it("a NonRetryableError goes directly to DLQ without retries", async () => {
    const queue = new MemoryQueue({ maxAttempts: 5 });
    let callCount = 0;

    queue.subscribe("test.nre", async () => {
      callCount++;
      throw new NonRetryableError("permanent business rejection");
    });

    await queue.start();
    await queue.publish("test.nre", {
      type: "test.nre",
      tenantId: "t1",
      actorId: "a1",
      correlationId: "c1",
      schemaVersion: "1",
      payload: {},
    });

    await new Promise((r) => setTimeout(r, 100));

    // Called exactly once (no retries for NonRetryableError)
    expect(callCount).toBe(1);
    expect(queue.dlq.length).toBe(1);
    expect(queue.dlq[0]!.error).toContain("permanent business rejection");
  });

  it("a successful handler does NOT go to DLQ", async () => {
    const queue = new MemoryQueue();
    let processed = false;

    queue.subscribe("test.success", async () => {
      processed = true;
    });

    await queue.start();
    await queue.publish("test.success", {
      type: "test.success",
      tenantId: "t1",
      actorId: "a1",
      correlationId: "c1",
      schemaVersion: "1",
      payload: {},
    });

    await new Promise((r) => setTimeout(r, 100));

    expect(processed).toBe(true);
    expect(queue.dlq.length).toBe(0);
  });
});
