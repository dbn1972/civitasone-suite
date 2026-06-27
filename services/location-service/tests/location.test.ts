/**
 * location-service tests — CQRS wiring with MemoryQueue + MemoryCache.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { MemoryQueue } from "@civitasone/queue";
import { Cache, MemoryCache } from "@civitasone/cache";
import { createLocationBody } from "../src/modules/locations/validators.js";
import { wouldCreateCycle, isValidLgdCode } from "../src/modules/locations/domain.js";

describe("location validators", () => {
  it("accepts minimal create body", () => {
    const body = createLocationBody.parse({ name: "HQ Office" });
    expect(body.name).toBe("HQ Office");
  });

  it("defaults type to office", () => {
    const body = createLocationBody.parse({ name: "HQ Office" });
    expect(body.type).toBe("office");
  });

  it("accepts the full hierarchy create body", () => {
    const body = createLocationBody.parse({
      name: "District Branch",
      type: "branch",
      lgdCode: "123456",
      parentId: "22222222-bbbb-4000-8000-000000000002",
    });
    expect(body.type).toBe("branch");
    expect(body.lgdCode).toBe("123456");
    expect(body.parentId).toBe("22222222-bbbb-4000-8000-000000000002");
  });

  it("rejects empty name", () => {
    expect(() => createLocationBody.parse({ name: "" })).toThrow();
  });

  it("rejects an invalid location type", () => {
    expect(() => createLocationBody.parse({ name: "X", type: "country" })).toThrow();
  });

  it("rejects a non-uuid parentId", () => {
    expect(() => createLocationBody.parse({ name: "X", parentId: "not-a-uuid" })).toThrow();
  });

  it("rejects a non-numeric LGD code", () => {
    expect(() => createLocationBody.parse({ name: "X", lgdCode: "AB12" })).toThrow();
  });
});

describe("wouldCreateCycle", () => {
  // a -> (root), b -> a, c -> b
  const edges = [
    { id: "a", parentId: null },
    { id: "b", parentId: "a" },
    { id: "c", parentId: "b" },
  ];

  it("allows attaching under a real ancestor that is not a descendant", () => {
    // new node d under c is fine
    expect(wouldCreateCycle(edges, "d", "c")).toBe(false);
  });

  it("allows a top-level node (no parent)", () => {
    expect(wouldCreateCycle(edges, "a", null)).toBe(false);
  });

  it("detects self-parenting", () => {
    expect(wouldCreateCycle(edges, "b", "b")).toBe(true);
  });

  it("detects a direct child becoming the parent", () => {
    // making a report to b (its child) is a cycle
    expect(wouldCreateCycle(edges, "a", "b")).toBe(true);
  });

  it("detects a deep descendant becoming the parent", () => {
    // making a report to c (its grandchild) is a cycle
    expect(wouldCreateCycle(edges, "a", "c")).toBe(true);
  });

  it("does not loop forever on pre-existing cyclic data", () => {
    const cyclic = [
      { id: "x", parentId: "y" },
      { id: "y", parentId: "x" },
    ];
    expect(wouldCreateCycle(cyclic, "z", "x")).toBe(false);
  });
});

describe("isValidLgdCode", () => {
  it("accepts digit-only codes", () => {
    expect(isValidLgdCode("123456")).toBe(true);
  });
  it("rejects non-digit codes", () => {
    expect(isValidLgdCode("12A4")).toBe(false);
    expect(isValidLgdCode("")).toBe(false);
  });
});

describe("write-via-queue + read-via-cache", () => {
  let queue: MemoryQueue;
  let cache: Cache;
  const store = new Map<string, { id: string; name: string; tenantId: string; status: string }>();

  beforeEach(() => {
    queue = new MemoryQueue();
    cache = new Cache({ service: "location", store: new MemoryCache(), defaultTtlSeconds: 60 });
    store.clear();

    queue.subscribe<{ id: string; name: string; tenantId: string; status: string }>(
      "location.location.create",
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
    const projected = {
      id,
      tenantId,
      name: "Branch Office",
      addressLine: null,
      city: null,
      postalCode: null,
      status: "active",
      version: 1,
    };
    await cache.put(cache.makeKey(tenantId, "location", id), projected);
    await queue.publish("location.location.create", {
      messageId: id,
      type: "location.location.create",
      tenantId,
      actorId: "00000000-aaaa-4000-8000-000000000001",
      correlationId: "c1",
      schemaVersion: "1.0",
      payload: projected,
    });

    expect(store.has(id)).toBe(false);
    const fromCache = await cache.getOrLoad(cache.makeKey(tenantId, "location", id), async () => null);
    expect(fromCache).toEqual(projected);

    await new Promise((r) => setTimeout(r, 20));
    expect(store.get(id)?.name).toBe("Branch Office");
  });

  it("listOrLoad caches paginated results", async () => {
    const tenantId = "11111111-aaaa-4000-8000-000000000003";
    const page = {
      data: [{
        id: "l1",
        tenantId,
        name: "One",
        addressLine: null,
        city: null,
        postalCode: null,
        status: "active",
        version: 1,
      }],
      pagination: { hasMore: false, pageSize: 50 },
    };
    let loads = 0;
    const first = await cache.listOrLoad(tenantId, "location", "list:50:0", async () => {
      loads++;
      return page;
    });
    const second = await cache.listOrLoad(tenantId, "location", "list:50:0", async () => {
      loads++;
      return page;
    });
    expect(first).toEqual(page);
    expect(second).toEqual(page);
    expect(loads).toBe(1);
  });
});
