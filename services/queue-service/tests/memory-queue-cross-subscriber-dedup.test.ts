import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { MemoryQueue } from "../src/bus.js";

/**
 * Regression test: MemoryQueue.deliver() used to dedupe deliveries with a
 * `seen` Set keyed only by `topic:messageId`, not by subscriber. Because
 * deliver() runs synchronously through `seen.add(key)` before its first
 * `await handler(msg)`, the FIRST subscriber registered on a topic to reach
 * that line "claimed" the message for the whole topic — every other
 * independent subscriber on the same topic silently never ran for that
 * message (treated as an already-seen duplicate), with no error, no DLQ
 * entry, nothing observable from publish()'s side.
 *
 * This is exactly the fan-out pattern admin-service's F3 route-write
 * consumers use: 8 unrelated modules (change, sandbox, central-config,
 * config, dept-templates, integration-settings, uploads, support) each call
 * `queue.subscribe(COMMANDS.f3RouteWrite, ...)` on the SAME topic and
 * internally switch on `msg.payload.op` to decide whether the message is
 * theirs. Only the first-registered subscriber ever actually ran per
 * message under the old keying.
 *
 * See bus.ts: MemoryQueue.seen / deliver() / subscribe() / publish().
 */
describe("MemoryQueue — cross-subscriber delivery dedup (regression)", () => {
  it("delivers one published message to every independent subscriber on the same topic", async () => {
    const q = new MemoryQueue();
    const receivedBy: string[] = [];

    q.subscribe("shared.topic", async () => {
      receivedBy.push("first");
    });
    q.subscribe("shared.topic", async () => {
      receivedBy.push("second");
    });
    q.subscribe("shared.topic", async () => {
      receivedBy.push("third");
    });

    await q.publish("shared.topic", {
      type: "shared.topic",
      tenantId: "t",
      actorId: "a",
      correlationId: "c",
      schemaVersion: "1.0",
      payload: {},
    });
    await q.drain();

    // Before the fix: only ["first"] — the second and third subscribers
    // were silently skipped as "already seen" for that topic+messageId.
    expect(receivedBy.sort()).toEqual(["first", "second", "third"]);
  });

  it("still protects a SINGLE subscriber from reprocessing the same message twice", async () => {
    // Idempotent-redelivery protection is the legitimate behavior the
    // original (buggy) dedup was trying to provide — this must survive the
    // fix, just correctly scoped to one subscriber instead of the whole
    // topic. Simulate redelivery by calling the internal deliver() path
    // twice for one subscriber via two publishes sharing a messageId.
    const q = new MemoryQueue();
    let calls = 0;
    q.subscribe("redelivery.topic", async () => {
      calls++;
    });

    // Generated once per run (not a static literal) so this test never writes
    // the same messageId into a real idempotency ledger across CI runs; both
    // publishes below reuse this single value, which is what the test needs
    // to exercise the same-id-twice redelivery path.
    const shared = {
      type: "redelivery.topic",
      tenantId: "t",
      actorId: "a",
      correlationId: "c",
      schemaVersion: "1.0",
      payload: {},
      messageId: randomUUID(),
    };

    await q.publish("redelivery.topic", shared);
    await q.publish("redelivery.topic", shared);
    await q.drain();

    expect(calls).toBe(1);
  });
});
