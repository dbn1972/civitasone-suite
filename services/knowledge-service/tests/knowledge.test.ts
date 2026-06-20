/**
 * knowledge-service tests.
 * Proves CQRS wiring with MemoryQueue + MemoryCache (no Postgres/Redis required).
 */
import { describe, it, expect, beforeEach } from "vitest";
import { MemoryQueue } from "@civitasone/queue";
import { Cache, MemoryCache } from "@civitasone/cache";
import { createDocumentBody } from "../src/modules/documents/validators.js";

describe("document validators", () => {
  it("accepts minimal create body", () => {
    const body = createDocumentBody.parse({ title: "Annual Report" });
    expect(body.title).toBe("Annual Report");
    expect(body.category).toBeUndefined();
  });

  it("accepts body with optional category", () => {
    const body = createDocumentBody.parse({ title: "Policy", category: "finance" });
    expect(body.category).toBe("finance");
  });

  it("rejects empty title", () => {
    expect(() => createDocumentBody.parse({ title: "" })).toThrow();
  });

  it("rejects missing title", () => {
    expect(() => createDocumentBody.parse({})).toThrow();
  });
});

describe("write-via-queue + read-via-cache", () => {
  let queue: MemoryQueue;
  let cache: Cache;
  const store = new Map<string, { id: string; title: string; tenantId: string; status: string }>();

  beforeEach(() => {
    queue = new MemoryQueue();
    cache = new Cache({ service: "knowledge", store: new MemoryCache(), defaultTtlSeconds: 60 });
    store.clear();

    queue.subscribe<{ id: string; title: string; tenantId: string; status: string }>(
      "knowledge.document.create",
      async (msg) => {
        store.set(msg.payload.id, {
          id: msg.payload.id,
          title: msg.payload.title,
          tenantId: msg.payload.tenantId,
          status: msg.payload.status,
        });
      }
    );
  });

  it("command primes cache before async DB write", async () => {
    const tenantId = "11111111-aaaa-4000-8000-000000000001";
    const id = "22222222-bbbb-4000-8000-000000000002";
    const projected = { id, tenantId, title: "Budget Policy 2026", status: "draft", category: null, version: 1 };

    await cache.put(cache.makeKey(tenantId, "document", id), projected);
    await queue.publish("knowledge.document.create", {
      messageId: id,
      type: "knowledge.document.create",
      tenantId,
      actorId: "00000000-aaaa-4000-8000-000000000001",
      correlationId: "c1",
      schemaVersion: "1.0",
      payload: projected,
    });

    expect(store.has(id)).toBe(false);
    const fromCache = await cache.getOrLoad(cache.makeKey(tenantId, "document", id), async () => null);
    expect(fromCache).toEqual(projected);

    await new Promise((r) => setTimeout(r, 20));
    expect(store.get(id)?.title).toBe("Budget Policy 2026");
  });

  it("listOrLoad caches paginated document results", async () => {
    const tenantId = "11111111-aaaa-4000-8000-000000000003";
    const page = {
      data: [{ id: "d1", tenantId, title: "Doc One", status: "draft", category: null, version: 1 }],
      pagination: { hasMore: false, pageSize: 50 },
    };
    let loads = 0;
    const first = await cache.listOrLoad(tenantId, "document", "list:50:0", async () => {
      loads++;
      return page;
    });
    const second = await cache.listOrLoad(tenantId, "document", "list:50:0", async () => {
      loads++;
      return page;
    });
    expect(first).toEqual(page);
    expect(second).toEqual(page);
    expect(loads).toBe(1);
  });

  it("different tenants do not share cached documents", async () => {
    const tenantA = "aaaaaaaa-0000-4000-8000-000000000001";
    const tenantB = "bbbbbbbb-0000-4000-8000-000000000002";
    const id = "dddddddd-0000-4000-8000-000000000001";

    await cache.put(cache.makeKey(tenantA, "document", id), { id, tenantId: tenantA, title: "Tenant A Doc" });
    const fromB = await cache.getOrLoad(cache.makeKey(tenantB, "document", id), async () => null);
    expect(fromB).toBeNull();
  });
});
