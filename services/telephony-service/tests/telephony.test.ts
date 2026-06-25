/**
 * telephony-service unit tests — validators + CQRS wiring (MemoryQueue + MemoryCache).
 * No DB/Redis required (mirrors helpdesk-service/tests/helpdesk.test.ts).
 */
import { describe, it, expect, beforeEach } from "vitest";
import { MemoryQueue } from "@civitasone/queue";
import { Cache, MemoryCache } from "@civitasone/cache";
import {
  createCallBody,
  completeCallBody,
  answerCallBody,
  ivrHitBody,
  listCallsQuery,
} from "../src/modules/calls/validators.js";

describe("call validators", () => {
  it("accepts a minimal inbound create body and defaults direction", () => {
    const body = createCallBody.parse({ callerNumber: "9876500011" });
    expect(body.direction).toBe("inbound");
    expect(body.callerNumber).toBe("9876500011");
  });

  it("rejects an invalid phone number", () => {
    expect(() => createCallBody.parse({ callerNumber: "ab" })).toThrow();
  });

  it("rejects an unknown disposition on complete", () => {
    expect(() => completeCallBody.parse({ disposition: "banana" })).toThrow();
    expect(completeCallBody.parse({ disposition: "resolved" }).disposition).toBe("resolved");
  });

  it("requires an agentId to answer", () => {
    expect(() => answerCallBody.parse({})).toThrow();
    expect(() => answerCallBody.parse({ agentId: "not-a-uuid" })).toThrow();
  });

  it("rejects non-DTMF IVR digits", () => {
    expect(() => ivrHitBody.parse({ menuKey: "main", digit: "abc" })).toThrow();
    expect(ivrHitBody.parse({ menuKey: "main", digit: "1" }).digit).toBe("1");
  });

  it("coerces + bounds list pagination", () => {
    expect(listCallsQuery.parse({}).limit).toBe(50);
    expect(() => listCallsQuery.parse({ limit: "9999" })).toThrow();
    expect(listCallsQuery.parse({ status: "ringing" }).status).toBe("ringing");
  });
});

describe("write-via-queue + read-via-cache", () => {
  let queue: MemoryQueue;
  let cache: Cache;
  const store = new Map<string, { id: string; tenantId: string; status: string }>();

  beforeEach(() => {
    queue = new MemoryQueue();
    cache = new Cache({ service: "telephony", store: new MemoryCache(), defaultTtlSeconds: 60 });
    store.clear();

    queue.subscribe<{ id: string; tenantId: string; status: string }>("telephony.call.create", async (msg) => {
      store.set(msg.payload.id, { id: msg.payload.id, tenantId: msg.payload.tenantId, status: msg.payload.status });
    });
  });

  it("command primes cache before the async DB write", async () => {
    const tenantId = "11111111-aaaa-4000-8000-000000000001";
    const id = "22222222-bbbb-4000-8000-000000000002";
    const projected = { id, tenantId, status: "queued" };
    await cache.put(cache.makeKey(tenantId, "call", id), projected);
    await queue.publish("telephony.call.create", {
      messageId: id,
      type: "telephony.call.create",
      tenantId,
      actorId: "00000000-aaaa-4000-8000-000000000001",
      correlationId: "c1",
      schemaVersion: "1.0",
      payload: projected,
    });

    expect(store.has(id)).toBe(false);
    const fromCache = await cache.getOrLoad(cache.makeKey(tenantId, "call", id), async () => null);
    expect(fromCache).toEqual(projected);

    await new Promise((r) => setTimeout(r, 20));
    expect(store.get(id)?.status).toBe("queued");
  });

  it("listOrLoad caches paginated results", async () => {
    const tenantId = "11111111-aaaa-4000-8000-000000000003";
    const page = { data: [{ id: "c1", tenantId, status: "queued" }], pagination: { hasMore: false, pageSize: 50 } };
    let loads = 0;
    const first = await cache.listOrLoad(tenantId, "call", "list:50:0", async () => {
      loads++;
      return page;
    });
    const second = await cache.listOrLoad(tenantId, "call", "list:50:0", async () => {
      loads++;
      return page;
    });
    expect(first).toEqual(page);
    expect(second).toEqual(page);
    expect(loads).toBe(1);
  });
});
