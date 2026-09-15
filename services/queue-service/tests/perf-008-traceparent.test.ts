import { describe, it, expect } from "vitest";
import { MemoryQueue, deriveTraceparent, type CommandEnvelope } from "../src/bus.js";

const TRACEPARENT_RE = /^[0-9a-f]{2}-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$/;

/**
 * PERF-008: trace-context propagation through the outbox/queue publish path.
 *
 * See deriveTraceparent()'s own doc comment (bus.ts) for the honest scope:
 * this is a deterministic, dependency-free, W3C-Trace-Context-FORMAT-valid
 * header derived from the envelope's own correlationId — not a claim that a
 * real OTel SDK produced it (none is installed anywhere in this repo today).
 */
describe("deriveTraceparent", () => {
  it("produces a valid W3C traceparent shape", () => {
    const tp = deriveTraceparent("corr-1");
    expect(tp).toMatch(TRACEPARENT_RE);
  });

  it("is deterministic in its trace-id root for the same correlationId (so every hop in one business flow joins the same trace)", () => {
    const a = deriveTraceparent("corr-shared");
    const b = deriveTraceparent("corr-shared");
    const [, traceIdA] = a.split("-");
    const [, traceIdB] = b.split("-");
    expect(traceIdA).toBe(traceIdB);
  });

  it("gives different correlationIds different trace-id roots", () => {
    const a = deriveTraceparent("corr-x");
    const b = deriveTraceparent("corr-y");
    const [, traceIdA] = a.split("-");
    const [, traceIdB] = b.split("-");
    expect(traceIdA).not.toBe(traceIdB);
  });

  it("gives the SAME correlationId a fresh span-id (parent-id) each call — each publish is its own hop", () => {
    const a = deriveTraceparent("corr-shared-2");
    const b = deriveTraceparent("corr-shared-2");
    const [, , spanIdA] = a.split("-");
    const [, , spanIdB] = b.split("-");
    expect(spanIdA).not.toBe(spanIdB);
  });

  it("passes through an explicit, already-valid traceparent unchanged (causal-chain forwarding)", () => {
    const explicit = "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01";
    expect(deriveTraceparent("corr-1", explicit)).toBe(explicit);
  });

  it("ignores a malformed explicit traceparent and derives a real one instead (fail-safe, not fail-closed)", () => {
    const derived = deriveTraceparent("corr-1", "not-a-real-traceparent");
    expect(derived).toMatch(TRACEPARENT_RE);
    expect(derived).not.toBe("not-a-real-traceparent");
  });
});

describe("Queue.publish() envelope carries a real traceparent end-to-end", () => {
  it("MemoryQueue: the delivered envelope has a valid traceparent derived from correlationId", async () => {
    const q = new MemoryQueue();
    const received: CommandEnvelope[] = [];
    q.subscribe("test.traceparent", async (msg) => { received.push(msg); });

    await q.publish("test.traceparent", {
      type: "test.traceparent",
      tenantId: "tenant-1",
      actorId: "actor-1",
      correlationId: "corr-tp-1",
      schemaVersion: "1.0",
      payload: {},
    });
    await new Promise((r) => setTimeout(r, 50));

    expect(received).toHaveLength(1);
    expect(received[0]?.traceparent).toMatch(TRACEPARENT_RE);
    const [, traceId] = received[0]!.traceparent.split("-");
    expect(traceId).toBe(deriveTraceparent("corr-tp-1").split("-")[1]);
  });

  it("MemoryQueue: two publishes with the same correlationId (a retry) share the same trace-id root", async () => {
    const q = new MemoryQueue();
    const received: CommandEnvelope[] = [];
    q.subscribe("test.traceparent.retry", async (msg) => { received.push(msg); });

    for (let i = 0; i < 2; i++) {
      await q.publish("test.traceparent.retry", {
        type: "test.traceparent.retry",
        tenantId: "tenant-1",
        actorId: "actor-1",
        correlationId: "corr-tp-retry",
        schemaVersion: "1.0",
        payload: { attempt: i },
      });
    }
    await new Promise((r) => setTimeout(r, 50));

    expect(received).toHaveLength(2);
    const [traceIdA] = [received[0]!.traceparent.split("-")[1]];
    const [traceIdB] = [received[1]!.traceparent.split("-")[1]];
    expect(traceIdA).toBe(traceIdB);
    // But each hop still gets its own span-id — not literally the same header.
    expect(received[0]!.traceparent).not.toBe(received[1]!.traceparent);
  });

  it("respects an explicit traceparent passed by the caller (forwarding an upstream trace)", async () => {
    const q = new MemoryQueue();
    const received: CommandEnvelope[] = [];
    q.subscribe("test.traceparent.explicit", async (msg) => { received.push(msg); });

    const upstream = "00-1111111111111111111111111111aaaa-2222222222222222-01";
    await q.publish("test.traceparent.explicit", {
      type: "test.traceparent.explicit",
      tenantId: "tenant-1",
      actorId: "actor-1",
      correlationId: "corr-tp-2",
      schemaVersion: "1.0",
      traceparent: upstream,
      payload: {},
    });
    await new Promise((r) => setTimeout(r, 50));

    expect(received[0]?.traceparent).toBe(upstream);
  });
});
