import { describe, it, expect, beforeEach } from "vitest";
import { MemoryQueue } from "@civitasone/queue";
import { Cache, MemoryCache } from "@civitasone/cache";
import { createTokenBody } from "../src/modules/tokens/validators.js";

describe("token validators", () => {
  it("accepts minimal create body", () => {
    const body = createTokenBody.parse({ name: "color.primary", value: "#0055aa" });
    expect(body.name).toBeDefined();
  });

  it("rejects empty name", () => {
    expect(() => createTokenBody.parse({ name: "", value: "#000" })).toThrow();
  });
});

describe("write-via-queue + read-via-cache", () => {
  let queue: MemoryQueue;
  let cache: Cache;
  const store = new Map<string, Record<string, unknown>>();

  beforeEach(() => {
    queue = new MemoryQueue();
    cache = new Cache({ service: "themes", store: new MemoryCache(), defaultTtlSeconds: 60 });
    store.clear();
    queue.subscribe("themes.token.create", async (msg: { payload: { id: string } & Record<string, unknown> }) => {
      store.set(msg.payload.id, msg.payload);
    });
  });

  it("command primes cache before async DB write", async () => {
    const tenantId = "11111111-aaaa-4000-8000-000000000001";
    const id = "22222222-bbbb-4000-8000-000000000002";
    const projected = { id, tenantId, name: "color.primary", value: "#0055aa", status: "active" };
    await cache.put(cache.makeKey(tenantId, "token", id), projected);
    await queue.publish("themes.token.create", {
      messageId: id, type: "themes.token.create", tenantId,
      actorId: "00000000-aaaa-4000-8000-000000000001", correlationId: "c1", schemaVersion: "1.0", payload: projected,
    });
    expect(store.has(id)).toBe(false);
    const fromCache = await cache.getOrLoad(cache.makeKey(tenantId, "token", id), async () => null);
    expect(fromCache).toEqual(projected);
    await new Promise((r) => setTimeout(r, 20));
    expect(store.get(id)).toBeDefined();
  });

  it("listOrLoad caches paginated results", async () => {
    const tenantId = "11111111-aaaa-4000-8000-000000000003";
    const page = { data: [{ id: "x1", tenantId, name: "color.primary", value: "#0055aa", status: "active" }], pagination: { hasMore: false, pageSize: 50 } };
    let loads = 0;
    const first = await cache.listOrLoad(tenantId, "token", "list:50:0", async () => { loads++; return page; });
    const second = await cache.listOrLoad(tenantId, "token", "list:50:0", async () => { loads++; return page; });
    expect(first).toEqual(page);
    expect(second).toEqual(page);
    expect(loads).toBe(1);
  });
});
