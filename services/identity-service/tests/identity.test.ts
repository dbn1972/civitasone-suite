import { describe, it, expect, beforeEach } from "vitest";
import { canTransition, assertTransition } from "../src/modules/users/domain.js";
import { MemoryQueue } from "@civitasone/queue";
import { Cache, MemoryCache } from "@civitasone/cache";

describe("user domain transitions", () => {
  it("allows active → suspended", () => expect(canTransition("active", "suspended")).toBe(true));
  it("allows active → deactivated", () => expect(canTransition("active", "deactivated")).toBe(true));
  it("blocks deactivated → active", () => expect(canTransition("deactivated", "active")).toBe(false));
  it("throws on invalid transition", () => expect(() => assertTransition("deactivated", "active")).toThrow());
});

describe("write-via-queue + read-via-cache (identity)", () => {
  let queue: MemoryQueue;
  let cache: Cache;
  const store = new Map<string, { id: string; email: string; status: string }>();

  beforeEach(() => {
    queue = new MemoryQueue();
    cache = new Cache({ service: "identity", store: new MemoryCache(), defaultTtlSeconds: 60 });
    store.clear();

    queue.subscribe<{ id: string; email: string }>("identity.user.create", async (msg) => {
      store.set(msg.payload.id, { id: msg.payload.id, email: msg.payload.email, status: "active" });
    });
  });

  it("cache primed for read-your-writes before DB write", async () => {
    const id = "11111111-1111-1111-1111-111111111111";
    const projected = { id, email: "admin@test.gov.in", status: "active" };
    await cache.put(cache.makeKey("t1", "user", id), projected);
    await queue.publish("identity.user.create", {
      messageId: id, type: "identity.user.create", tenantId: "t1", actorId: "a1",
      correlationId: "c1", schemaVersion: "1.0", payload: { id, email: "admin@test.gov.in" },
    });
    expect(store.has(id)).toBe(false);
    const fromCache = await cache.getOrLoad(cache.makeKey("t1", "user", id), async () => null);
    expect(fromCache).toEqual(projected);
    await new Promise((r) => setTimeout(r, 20));
    expect(store.get(id)?.email).toBe("admin@test.gov.in");
  });

  it("read-through loads from source on cache miss", async () => {
    store.set("u2", { id: "u2", email: "user@dept.gov.in", status: "active" });
    const v = await cache.getOrLoad(cache.makeKey("t1", "user", "u2"), async () => store.get("u2") ?? null);
    expect(v?.email).toBe("user@dept.gov.in");
    store.clear();
    const again = await cache.getOrLoad(cache.makeKey("t1", "user", "u2"), async () => null);
    expect(again?.email).toBe("user@dept.gov.in");
  });

  it("consumer dedupes repeated messageId", async () => {
    let count = 0;
    queue.subscribe<{ id: string }>("identity.user.touch", async () => { count++; });
    const opts = { messageId: "same", type: "identity.user.touch", tenantId: "t", actorId: "u", correlationId: "c", schemaVersion: "1.0", payload: { id: "t" } };
    await queue.publish("identity.user.touch", opts);
    await queue.publish("identity.user.touch", opts);
    await new Promise((r) => setTimeout(r, 20));
    expect(count).toBe(1);
  });
});

describe("identity-service route auth (inject)", () => {
  it("GET /identity/sessions without token → 401", async () => {
    const { buildApp } = await import("../src/app.js");
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/identity/sessions" });
    expect(res.statusCode).toBe(401);
    await app.close();
  });
});
