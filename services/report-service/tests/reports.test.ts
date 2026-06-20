/**
 * report-service tests — CQRS wiring with MemoryQueue + MemoryCache.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { MemoryQueue } from "@civitasone/queue";
import { Cache, MemoryCache } from "@civitasone/cache";
import { createJobBody } from "../src/modules/jobs/validators.js";

describe("job validators", () => {
  it("accepts minimal create body", () => {
    const body = createJobBody.parse({ name: "Sample Job" });
    expect(body.name).toBe("Sample Job");
  });

  it("rejects empty name", () => {
    expect(() => createJobBody.parse({ name: "" })).toThrow();
  });
});

describe("write-via-queue + read-via-cache", () => {
  let queue: MemoryQueue;
  let cache: Cache;
  const store = new Map<string, { id: string; name: string; tenantId: string; status: string }>();

  beforeEach(() => {
    queue = new MemoryQueue();
    cache = new Cache({ service: "reports", store: new MemoryCache(), defaultTtlSeconds: 60 });
    store.clear();

    queue.subscribe<{ id: string; name: string; tenantId: string; status: string }>(
      "reports.job.create",
      async (msg) => {
        store.set(msg.payload.id, {
          id: msg.payload.id,
          name: msg.payload.name,
          tenantId: msg.payload.tenantId,
          status: msg.payload.status,
        });
      }
    );
  });

  it("command primes cache before async DB write", async () => {
    const tenantId = "11111111-aaaa-4000-8000-000000000001";
    const id = "22222222-bbbb-4000-8000-000000000002";
    const projected = { id, tenantId, name: "Test Job", status: "active" };
    await cache.put(cache.makeKey(tenantId, "job", id), projected);
    await queue.publish("reports.job.create", {
      messageId: id,
      type: "reports.job.create",
      tenantId,
      actorId: "00000000-aaaa-4000-8000-000000000001",
      correlationId: "c1",
      schemaVersion: "1.0",
      payload: projected,
    });

    expect(store.has(id)).toBe(false);
    const fromCache = await cache.getOrLoad(cache.makeKey(tenantId, "job", id), async () => null);
    expect(fromCache).toEqual(projected);

    await new Promise((r) => setTimeout(r, 20));
    expect(store.get(id)?.name).toBe("Test Job");
  });

  it("listOrLoad caches paginated results", async () => {
    const tenantId = "11111111-aaaa-4000-8000-000000000003";
    const page = {
      data: [{ id: "c1", tenantId, name: "One", status: "active" }],
      pagination: { hasMore: false, pageSize: 50 },
    };
    let loads = 0;
    const first = await cache.listOrLoad(tenantId, "job", "list:50:0", async () => {
      loads++;
      return page;
    });
    const second = await cache.listOrLoad(tenantId, "job", "list:50:0", async () => {
      loads++;
      return page;
    });
    expect(first).toEqual(page);
    expect(second).toEqual(page);
    expect(loads).toBe(1);
  });
});
