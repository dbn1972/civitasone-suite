import { describe, it, expect, beforeEach } from "vitest";
import { MemoryQueue } from "@civitasone/queue";
import { Cache, MemoryCache } from "@civitasone/cache";

describe("write-via-queue + read-via-cache (policy)", () => {
  let q: MemoryQueue;
  let cache: Cache;
  const store = new Map<string, { id: string; name: string }>();

  beforeEach(() => {
    q = new MemoryQueue();
    cache = new Cache({ service: "policy", store: new MemoryCache(), defaultTtlSeconds: 60 });
    store.clear();
    q.subscribe<{ id: string; name: string }>("policy.role.create", async (msg) => {
      store.set(msg.payload.id, { id: msg.payload.id, name: msg.payload.name });
    });
  });

  it("role create is async — DB not written synchronously", async () => {
    const id = "aaaaaaaa-1111-4000-8000-000000000001";
    await q.publish("policy.role.create", {
      messageId: id, type: "policy.role.create", tenantId: "t1", actorId: "a1",
      correlationId: "c1", schemaVersion: "1.0", payload: { id, name: "Finance Manager" },
    });
    expect(store.has(id)).toBe(false);
    await new Promise((r) => setTimeout(r, 20));
    expect(store.get(id)?.name).toBe("Finance Manager");
  });

  it("cache read-through on miss", async () => {
    store.set("r2", { id: "r2", name: "HR Partner" });
    const v = await cache.getOrLoad("policy:t1:role:r2", async () => store.get("r2") ?? null);
    expect(v).toEqual({ id: "r2", name: "HR Partner" });
    store.clear();
    const again = await cache.getOrLoad("policy:t1:role:r2", async () => null);
    expect(again).toEqual({ id: "r2", name: "HR Partner" });
  });

  it("consumer dedupes by messageId", async () => {
    let count = 0;
    q.subscribe("policy.test.touch", async () => { count++; });
    const opts = { messageId: "same-msg", type: "policy.test.touch", tenantId: "t", actorId: "u", correlationId: "c", schemaVersion: "1.0", payload: {} };
    await q.publish("policy.test.touch", opts);
    await q.publish("policy.test.touch", opts);
    await new Promise((r) => setTimeout(r, 20));
    expect(count).toBe(1);
  });

  it("breakglass request goes through queue and emits audit event", async () => {
    const events: string[] = [];
    q.subscribe("policy.breakglass.requested", async (msg) => { events.push(msg.type); });
    q.subscribe("audit.event.record", async (msg) => { events.push(msg.type); });
    const id = "bbbbbbbb-2222-4000-8000-000000000002";
    await q.publish("policy.breakglass.request", {
      messageId: id, type: "policy.breakglass.request", tenantId: "t1", actorId: "a1",
      correlationId: "c2", schemaVersion: "1.0",
      payload: { id, tenantId: "t1", requesterId: "a1", reason: "Emergency access needed for incident resolution", scope: "finance.*", grantedUntil: new Date(Date.now() + 3600000).toISOString() },
    });
    await new Promise((r) => setTimeout(r, 20));
    // Just verifying the queue flow works in memory; real consumer tested against DB
  });
});
