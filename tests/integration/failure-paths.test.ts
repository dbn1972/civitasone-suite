/**
 * NEGATIVE-path integration tests over the real in-process MemoryQueue.
 *
 * These exercise the failure contracts of `MemoryQueue` (services/queue-service
 * /src/bus.ts) directly — no service mocking — by publishing onto the bus and
 * registering simple test handlers, then asserting on the dead-letter queue
 * (`queue.dlq`) and handler invocation counts.
 *
 * Contracts under test (see bus.ts `MemoryQueue.deliver`):
 *   - `deliver()` calls `parseEnvelope()` BEFORE any handler runs; an invalid
 *     envelope is pushed to `dlq` with `error` = `invalid_envelope: <detail>`
 *     and the handler is NEVER invoked.
 *   - a handler that throws is retried up to `maxAttempts`; on the final failed
 *     attempt the message is pushed to `dlq` with the thrown error message.
 *   - a valid envelope whose handler succeeds is delivered exactly once and is
 *     never dead-lettered.
 *   - `seen` dedup keys on `${topic}:${messageId}`, so re-publishing the SAME
 *     messageId delivers to the handler only once.
 *
 * Envelope validity (packages/events/src/envelope.ts): `MemoryQueue.publish`
 * always builds the envelope via `envelope()`, which auto-assigns a uuid
 * `messageId` and an ISO `timestamp`. The remaining fields are caller-supplied.
 * The schema requires `type` (z.string().min(1)) and `schemaVersion`
 * (z.string().min(1)) to be non-empty — so the controllable field we set to ""
 * to force rejection is `type` (min(1) ⇒ "" is invalid).
 */
import { describe, it, expect, beforeEach } from "vitest";
import { MemoryQueue } from "../../packages/queue/dist/index.js";
import { ChainHarness } from "./harness.js";

const TENANT = "11111111-aaaa-4000-8000-000000000001";
const ACTOR = "22222222-bbbb-4000-8000-000000000001";

/** A structurally VALID publish input (messageId/timestamp auto-filled by publish). */
function validInput(type: string, payload: Record<string, unknown> = {}) {
  return {
    type,
    tenantId: TENANT,
    actorId: ACTOR,
    correlationId: "corr-failure-paths",
    schemaVersion: "1.0",
    payload,
  };
}

/** Let the bus's setTimeout(0) delivery + retry/backoff loop run. */
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("queue failure paths — negative integration tests", () => {
  let harness: ChainHarness;

  beforeEach(() => {
    harness = new ChainHarness();
  });

  it("1. malformed envelope → DLQ, handler never runs", async () => {
    const topic = "failpath.malformed";
    let calls = 0;
    harness.queue.subscribe(topic, async () => {
      calls++;
    });

    // `type: ""` violates eventEnvelopeSchema (type: z.string().min(1)).
    // publish() auto-assigns a valid uuid messageId + timestamp, so `type` is
    // the controllable field we use to force parseEnvelope() to reject.
    await harness.queue.publish(topic, validInput("", { foo: "bar" }));
    await wait(50);

    // parseEnvelope runs in deliver() before any handler — handler never fires.
    expect(calls).toBe(0);
    const entry = harness.queue.dlq.find((d) => d.topic === topic);
    expect(entry).toBeDefined();
    expect(entry?.error.startsWith("invalid_envelope")).toBe(true);
  });

  it("2. throwing handler → DLQ after maxAttempts, no infinite loop", async () => {
    // Construct directly so we control the attempt budget.
    const q = new MemoryQueue({ maxAttempts: 3 });
    const topic = "failpath.throws";
    let calls = 0;
    q.subscribe(topic, async () => {
      calls++;
      throw new Error("handler boom");
    });

    await q.publish(topic, validInput(topic));
    // allow the in-process retry/backoff loop to exhaust all attempts
    await wait(300);

    expect(calls).toBe(3);
    expect(q.dlq.length).toBe(1);
    expect(q.dlq[0]?.topic).toBe(topic);
    expect(q.dlq[0]?.error).toBe("handler boom");
  });

  it("3. valid envelope → handler runs once, NOT dead-lettered", async () => {
    const topic = "failpath.valid";
    let calls = 0;
    harness.queue.subscribe(topic, async () => {
      calls++;
    });

    await harness.queue.publish(topic, validInput(topic, { ok: true }));
    await wait(50);

    expect(calls).toBe(1);
    expect(harness.queue.dlq.filter((d) => d.topic === topic)).toHaveLength(0);
  });

  it("4. idempotency → same messageId published twice delivers once", async () => {
    const topic = "failpath.dedup";
    let calls = 0;
    harness.queue.subscribe(topic, async () => {
      calls++;
    });

    const messageId = "33333333-cccc-4000-8000-000000000001";
    await harness.queue.publish(topic, { ...validInput(topic), messageId });
    await harness.queue.publish(topic, { ...validInput(topic), messageId });
    await wait(80);

    // MemoryQueue.seen dedups on `${topic}:${messageId}`.
    expect(calls).toBe(1);
    expect(harness.queue.dlq.filter((d) => d.topic === topic)).toHaveLength(0);
  });
});
