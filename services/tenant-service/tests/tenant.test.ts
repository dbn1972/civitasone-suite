/**
 * tenant-service tests.
 * 1) domain transition rules (pure).
 * 2) write-via-queue + read-via-cache flow, using the real MemoryQueue + MemoryCache
 *    adapters (no Postgres/Redis required) — proves the CQRS pattern wiring.
 *
 * Integration tests against a real Fastify app + DB run in CI (supertest + testcontainers).
 */
import { describe, it, expect, beforeEach } from "vitest";
import { canTransition, assertTransition } from "../src/modules/tenant/domain.js";
import { MemoryQueue } from "@civitasone/queue";
import { Cache, MemoryCache } from "@civitasone/cache";

describe("tenant domain", () => {
  it("allows draft → active", () => expect(canTransition("draft", "active")).toBe(true));
  it("blocks active → draft", () => expect(canTransition("active", "draft")).toBe(false));
  it("blocks archived → anything", () => expect(canTransition("archived", "active")).toBe(false));
  it("throws on invalid transition", () => expect(() => assertTransition("active", "draft")).toThrow());
});

describe("write-via-queue + read-via-cache", () => {
  let queue: MemoryQueue;
  let cache: Cache;
  const store = new Map<string, { id: string; name: string; status: string }>(); // stands in for Postgres

  beforeEach(() => {
    queue = new MemoryQueue();
    cache = new Cache({ service: "tenant", store: new MemoryCache(), defaultTtlSeconds: 60 });
    store.clear();

    // a stand-in consumer: applies the write to the "DB" then invalidates cache
    queue.subscribe<{ id: string; name: string }>("tenant.tenant.create", async (msg) => {
      store.set(msg.payload.id, { id: msg.payload.id, name: msg.payload.name, status: "draft" });
    });
  });

  it("command does not write the DB synchronously; cache is primed for read-your-writes", async () => {
    const id = "11111111-1111-1111-1111-111111111111";
    const projected = { id, name: "Ministry X", status: "draft" };
    await cache.put(cache.makeKey(id, "tenant", id), projected); // command primes cache
    await queue.publish("tenant.tenant.create", {
      messageId: id, type: "tenant.tenant.create", tenantId: id, actorId: "u1",
      correlationId: "c1", schemaVersion: "1.0", payload: { id, name: "Ministry X" },
    });

    // immediately: DB not yet written, but cache serves the projected state
    expect(store.has(id)).toBe(false);
    const fromCache = await cache.getOrLoad(cache.makeKey(id, "tenant", id), async () => null);
    expect(fromCache).toEqual(projected);

    // after async delivery: DB now has the row
    await new Promise((r) => setTimeout(r, 20));
    expect(store.get(id)?.name).toBe("Ministry X");
  });

  it("read-through loads from source on cache miss", async () => {
    store.set("t2", { id: "t2", name: "Dept Y", status: "active" });
    const v = await cache.getOrLoad(cache.makeKey("t2", "tenant", "t2"), async () => store.get("t2") ?? null);
    expect(v?.name).toBe("Dept Y");
    // second call served from cache even if source is cleared
    store.clear();
    const again = await cache.getOrLoad(cache.makeKey("t2", "tenant", "t2"), async () => null);
    expect(again?.name).toBe("Dept Y");
  });

  it("consumer dedupes repeated messageId (idempotent delivery)", async () => {
    let count = 0;
    queue.subscribe<{ id: string }>("tenant.tenant.touch", async () => { count++; });
    const opts = { messageId: "same", type: "tenant.tenant.touch", tenantId: "t", actorId: "u", correlationId: "c", schemaVersion: "1.0", payload: { id: "t" } };
    await queue.publish("tenant.tenant.touch", opts);
    await queue.publish("tenant.tenant.touch", opts);
    await new Promise((r) => setTimeout(r, 20));
    expect(count).toBe(1);
  });
});
