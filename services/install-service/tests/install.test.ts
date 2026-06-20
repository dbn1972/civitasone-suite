import { describe, it, expect, beforeEach } from "vitest";
import { MemoryQueue } from "@civitasone/queue";
import { Cache, MemoryCache } from "@civitasone/cache";
import { createStageBody } from "../src/modules/stages/validators.js";

describe("stage validators", () => {
  it("accepts minimal create body", () => {
    const body = createStageBody.parse({ name: "deployment-mode", stepNumber: 1 });
    expect(body.name).toBeDefined();
  });

  it("rejects empty name", () => {
    expect(() => createStageBody.parse({ name: "", stepNumber: 1 })).toThrow();
  });
});

describe("write-via-queue + read-via-cache", () => {
  let queue: MemoryQueue;
  let cache: Cache;
  const store = new Map<string, Record<string, unknown>>();

  beforeEach(() => {
    queue = new MemoryQueue();
    cache = new Cache({ service: "install", store: new MemoryCache(), defaultTtlSeconds: 60 });
    store.clear();
    queue.subscribe("install.stage.create", async (msg: { payload: { id: string } & Record<string, unknown> }) => {
      store.set(msg.payload.id, msg.payload);
    });
  });

  it("command primes cache before async DB write", async () => {
    const tenantId = "11111111-aaaa-4000-8000-000000000001";
    const id = "22222222-bbbb-4000-8000-000000000002";
    const projected = { id, tenantId, name: "deployment-mode", stepNumber: 1, status: "active" };
    await cache.put(cache.makeKey(tenantId, "stage", id), projected);
    await queue.publish("install.stage.create", {
      messageId: id, type: "install.stage.create", tenantId,
      actorId: "00000000-aaaa-4000-8000-000000000001", correlationId: "c1", schemaVersion: "1.0", payload: projected,
    });
    expect(store.has(id)).toBe(false);
    const fromCache = await cache.getOrLoad(cache.makeKey(tenantId, "stage", id), async () => null);
    expect(fromCache).toEqual(projected);
    await new Promise((r) => setTimeout(r, 20));
    expect(store.get(id)).toBeDefined();
  });

  it("listOrLoad caches paginated results", async () => {
    const tenantId = "11111111-aaaa-4000-8000-000000000003";
    const page = { data: [{ id: "x1", tenantId, name: "deployment-mode", stepNumber: 1, status: "active" }], pagination: { hasMore: false, pageSize: 50 } };
    let loads = 0;
    const first = await cache.listOrLoad(tenantId, "stage", "list:50:0", async () => { loads++; return page; });
    const second = await cache.listOrLoad(tenantId, "stage", "list:50:0", async () => { loads++; return page; });
    expect(first).toEqual(page);
    expect(second).toEqual(page);
    expect(loads).toBe(1);
  });
});
