import { describe, it, expect, beforeEach } from "vitest";
import { MemoryQueue } from "@civitasone/queue";
import { Cache, MemoryCache } from "@civitasone/cache";
import { computeHash } from "../src/modules/events/domain.js";

describe("audit event hash chain", () => {
  it("produces deterministic sha256 hash", () => {
    const h1 = computeHash("id1", "tenant1", "identity.user.created", null, "2026-06-20T00:00:00.000Z");
    const h2 = computeHash("id1", "tenant1", "identity.user.created", null, "2026-06-20T00:00:00.000Z");
    expect(h1).toBe(h2);
    expect(h1).toHaveLength(64);
  });

  it("different prev_hash produces different output", () => {
    const h1 = computeHash("id1", "t1", "type", null, "2026-06-20T00:00:00.000Z");
    const h2 = computeHash("id1", "t1", "type", "prev", "2026-06-20T00:00:00.000Z");
    expect(h1).not.toBe(h2);
  });
});

describe("audit consumer queue wiring", () => {
  let q: MemoryQueue;
  const store: Array<{ tenantId: string; type: string }> = [];

  beforeEach(() => {
    q = new MemoryQueue();
    store.length = 0;
    q.subscribe<{ service: string; action: string; resourceType: string; resourceId: string; outcome: string }>(
      "audit.event.record",
      async (msg) => { store.push({ tenantId: msg.tenantId, type: msg.type }); }
    );
  });

  it("routes audit.event.record to consumer", async () => {
    await q.publish("audit.event.record", {
      messageId: "m1", type: "audit.event.record", tenantId: "t1", actorId: "a1",
      correlationId: "c1", schemaVersion: "1.0",
      payload: { service: "policy", action: "create", resourceType: "role", resourceId: "r1", outcome: "success" },
    });
    await new Promise((r) => setTimeout(r, 20));
    expect(store).toHaveLength(1);
    expect(store[0]?.tenantId).toBe("t1");
  });

  it("dedupes repeated messageId", async () => {
    let count = 0;
    q.subscribe("audit.event.ingest", async () => { count++; });
    const opts = { messageId: "dup-msg", type: "audit.event.ingest", tenantId: "t1", actorId: "a1", correlationId: "c1", schemaVersion: "1.0", payload: { service: "s", action: "a", resourceType: "r", resourceId: "x", outcome: "success" } };
    await q.publish("audit.event.ingest", opts);
    await q.publish("audit.event.ingest", opts);
    await new Promise((r) => setTimeout(r, 20));
    expect(count).toBe(1);
  });
});

describe("audit-service route auth (inject)", () => {
  it("GET /v1/audit/risks without token → 401", async () => {
    const { buildApp } = await import("../src/app.js");
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/audit/risks" });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it("GET /v1/audit/exports without token → 401", async () => {
    const { buildApp } = await import("../src/app.js");
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/audit/exports" });
    expect(res.statusCode).toBe(401);
    await app.close();
  });
});
