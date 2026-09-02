import { describe, it, expect } from "vitest";
import { MemoryQueue } from "../src/bus.js";

/**
 * Regression test for the MemoryQueue.stop() timer leak: stop() used to only
 * clear `this.handlers`, leaving any in-flight retry-backoff `setTimeout`
 * (scheduled by deliver() for a message whose handler is still failing/
 * retrying) alive. When that timer eventually fired — often during a later,
 * unrelated test — it re-invoked the stale handler, producing flaky
 * "expected spy to be called N times but got N+1" failures in whatever test
 * happened to be running at the time.
 *
 * See bus.ts: MemoryQueue.retryTimers / stop() / retryDelay().
 */
describe("MemoryQueue.stop() — retry-backoff timer leak (regression)", () => {
  it("cancels a pending retry so the handler is never invoked again after stop()", async () => {
    const q = new MemoryQueue({ maxAttempts: 5 });
    let calls = 0;
    q.subscribe("test.topic", async () => {
      calls++;
      throw new Error("always fails");
    });

    await q.publish("test.topic", {
      type: "test.topic",
      tenantId: "t",
      actorId: "a",
      correlationId: "c",
      schemaVersion: "1.0",
      payload: {},
    });

    // Let the first attempt run and fail, scheduling a retry backoff
    // (2^1 * 10 = 20ms) — but stop() before that backoff elapses.
    await new Promise((r) => setTimeout(r, 5));
    expect(calls).toBe(1);

    await q.stop();

    // Wait well past every backoff the retry loop could have scheduled
    // (2^1..2^4 * 10ms = 20/40/80/160ms) to prove no leaked timer fires.
    await new Promise((r) => setTimeout(r, 300));

    expect(calls).toBe(1);
  });

  it("a queue that is never stopped still retries normally (no regression to retry semantics)", async () => {
    const q = new MemoryQueue({ maxAttempts: 3 });
    let calls = 0;
    q.subscribe("test.topic", async () => {
      calls++;
      throw new Error("always fails");
    });

    await q.publish("test.topic", {
      type: "test.topic",
      tenantId: "t",
      actorId: "a",
      correlationId: "c",
      schemaVersion: "1.0",
      payload: {},
    });

    await new Promise((r) => setTimeout(r, 200));

    expect(calls).toBe(3);
    expect(q.dlq.length).toBe(1);
  });
});
