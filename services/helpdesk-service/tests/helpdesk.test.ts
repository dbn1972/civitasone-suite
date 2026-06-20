/**
 * helpdesk-service tests — CQRS wiring with MemoryQueue + MemoryCache.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { MemoryQueue } from "@civitasone/queue";
import { Cache, MemoryCache } from "@civitasone/cache";
import { createTicketBody } from "../src/modules/tickets/validators.js";

describe("ticket validators", () => {
  it("accepts minimal create body", () => {
    const body = createTicketBody.parse({ subject: "Network outage" });
    expect(body.subject).toBe("Network outage");
  });

  it("rejects empty subject", () => {
    expect(() => createTicketBody.parse({ subject: "" })).toThrow();
  });
});

describe("write-via-queue + read-via-cache", () => {
  let queue: MemoryQueue;
  let cache: Cache;
  const store = new Map<string, { id: string; subject: string; tenantId: string; priority: string; status: string }>();

  beforeEach(() => {
    queue = new MemoryQueue();
    cache = new Cache({ service: "helpdesk", store: new MemoryCache(), defaultTtlSeconds: 60 });
    store.clear();

    queue.subscribe<{ id: string; subject: string; tenantId: string; priority: string; status: string }>(
      "helpdesk.ticket.create",
      async (msg) => {
        store.set(msg.payload.id, {
          id: msg.payload.id,
          subject: msg.payload.subject,
          tenantId: msg.payload.tenantId,
          priority: msg.payload.priority,
          status: msg.payload.status,
        });
      }
    );
  });

  it("command primes cache before async DB write", async () => {
    const tenantId = "11111111-aaaa-4000-8000-000000000001";
    const id = "22222222-bbbb-4000-8000-000000000002";
    const projected = { id, subject: "Printer jam", priority: "Medium" as const, status: "Open" as const };
    await cache.put(cache.makeKey(tenantId, "ticket", id), projected);
    await queue.publish("helpdesk.ticket.create", {
      messageId: id,
      type: "helpdesk.ticket.create",
      tenantId,
      actorId: "00000000-aaaa-4000-8000-000000000001",
      correlationId: "c1",
      schemaVersion: "1.0",
      payload: { id, tenantId, subject: "Printer jam", priority: "Medium", status: "open" },
    });

    expect(store.has(id)).toBe(false);
    const fromCache = await cache.getOrLoad(cache.makeKey(tenantId, "ticket", id), async () => null);
    expect(fromCache).toEqual(projected);

    await new Promise((r) => setTimeout(r, 20));
    expect(store.get(id)?.subject).toBe("Printer jam");
  });

  it("listOrLoad caches paginated results", async () => {
    const tenantId = "11111111-aaaa-4000-8000-000000000003";
    const page = {
      data: [{ id: "t1", subject: "One", priority: "Low" as const, status: "Open" as const }],
      pagination: { hasMore: false, pageSize: 50 },
    };
    let loads = 0;
    const first = await cache.listOrLoad(tenantId, "ticket", "list:50:0", async () => {
      loads++;
      return page;
    });
    const second = await cache.listOrLoad(tenantId, "ticket", "list:50:0", async () => {
      loads++;
      return page;
    });
    expect(first).toEqual(page);
    expect(second).toEqual(page);
    expect(loads).toBe(1);
  });
});
