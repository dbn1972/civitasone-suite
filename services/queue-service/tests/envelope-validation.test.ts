import { describe, it, expect } from "vitest";
import { MemoryQueue, type CommandEnvelope, type PublishInput } from "../src/bus.js";

/**
 * 04-T3: runtime event validation at the consume boundary.
 *
 * A structurally invalid envelope (e.g. missing tenantId or blank
 * schemaVersion) must be rejected → dead-lettered, never delivered to a
 * handler, and never crash the consumer.
 */
describe("envelope validation — consume boundary (04-T3)", () => {
  it("delivers a valid envelope to the subscribed handler", async () => {
    const q = new MemoryQueue();
    const received: CommandEnvelope[] = [];
    q.subscribe("test.valid", async (msg) => { received.push(msg); });

    await q.publish("test.valid", {
      type: "test.valid",
      tenantId: "tenant-1",
      actorId: "actor-1",
      correlationId: "corr-1",
      schemaVersion: "1.0",
      payload: { hello: "world" },
    });
    await new Promise((r) => setTimeout(r, 50));

    expect(received.length).toBe(1);
    expect(received[0]?.tenantId).toBe("tenant-1");
    expect(q.dlq.length).toBe(0);
  });

  it("rejects an envelope missing tenantId → dead-letter, never delivered", async () => {
    const q = new MemoryQueue();
    let delivered = 0;
    q.subscribe("test.invalid", async () => { delivered++; });

    // tenantId omitted — invalid envelope. Cast bypasses the compile-time guard
    // to simulate a malformed message arriving off the wire.
    await q.publish("test.invalid", {
      type: "test.invalid",
      actorId: "actor-1",
      correlationId: "corr-1",
      schemaVersion: "1.0",
      payload: {},
    } as unknown as PublishInput<unknown>);
    await new Promise((r) => setTimeout(r, 50));

    expect(delivered).toBe(0);
    expect(q.dlq.length).toBe(1);
    expect(q.dlq[0]?.topic).toBe("test.invalid");
    expect(q.dlq[0]?.error).toContain("invalid_envelope");
  });

  it("rejects an envelope with a blank schemaVersion (04-T3 minimal guard)", async () => {
    const q = new MemoryQueue();
    let delivered = 0;
    q.subscribe("test.noversion", async () => { delivered++; });

    await q.publish("test.noversion", {
      type: "test.noversion",
      tenantId: "tenant-1",
      actorId: "actor-1",
      correlationId: "corr-1",
      schemaVersion: "",
      payload: {},
    });
    await new Promise((r) => setTimeout(r, 50));

    expect(delivered).toBe(0);
    expect(q.dlq.length).toBe(1);
    expect(q.dlq[0]?.error).toContain("invalid_envelope");
  });
});
