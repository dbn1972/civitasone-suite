/**
 * analytics-service tests.
 * Proves CQRS wiring with MemoryQueue + MemoryCache (no Postgres/Redis required).
 */
import { describe, it, expect, beforeEach } from "vitest";
import { MemoryQueue } from "@civitasone/queue";
import { Cache, MemoryCache } from "@civitasone/cache";
import { dashboardViewSchema, dashboardsListSchema } from "../src/modules/dashboards/validators.js";
import { runQueryBody, queryRunViewSchema } from "../src/modules/queries/validators.js";

describe("dashboard validators", () => {
  it("validates dashboard view", () => {
    const view = dashboardViewSchema.parse({
      id: "11111111-aaaa-4000-8000-000000000001",
      tenantId: "22222222-bbbb-4000-8000-000000000002",
      name: "Finance Overview",
      description: "Monthly finance metrics",
      status: "active",
      version: 1,
    });
    expect(view.name).toBe("Finance Overview");
  });

  it("accepts null description in dashboard view", () => {
    const view = dashboardViewSchema.parse({
      id: "11111111-aaaa-4000-8000-000000000001",
      tenantId: "22222222-bbbb-4000-8000-000000000002",
      name: "KPI Board",
      description: null,
      status: "active",
      version: 1,
    });
    expect(view.description).toBeNull();
  });

  it("validates paginated dashboards list", () => {
    const list = dashboardsListSchema.parse({
      data: [],
      pagination: { hasMore: false, pageSize: 50 },
    });
    expect(list.data).toHaveLength(0);
  });
});

describe("query run validators", () => {
  it("accepts valid run query body", () => {
    const body = runQueryBody.parse({ queryName: "budget_summary" });
    expect(body.queryName).toBe("budget_summary");
    expect(body.dashboardId).toBeUndefined();
  });

  it("accepts optional dashboardId", () => {
    const body = runQueryBody.parse({
      queryName: "spend_by_dept",
      dashboardId: "33333333-cccc-4000-8000-000000000003",
    });
    expect(body.dashboardId).toBe("33333333-cccc-4000-8000-000000000003");
  });

  it("rejects empty queryName", () => {
    expect(() => runQueryBody.parse({ queryName: "" })).toThrow();
  });

  it("rejects non-UUID dashboardId", () => {
    expect(() => runQueryBody.parse({ queryName: "q1", dashboardId: "not-a-uuid" })).toThrow();
  });

  it("validates query run view schema", () => {
    const view = queryRunViewSchema.parse({
      id: "44444444-dddd-4000-8000-000000000004",
      tenantId: "22222222-bbbb-4000-8000-000000000002",
      dashboardId: null,
      queryName: "budget_summary",
      status: "running",
      resultRows: 0,
      version: 1,
    });
    expect(view.status).toBe("running");
  });
});

describe("write-via-queue + read-via-cache", () => {
  let queue: MemoryQueue;
  let cache: Cache;
  const store = new Map<string, { id: string; queryName: string; tenantId: string; status: string }>();

  beforeEach(() => {
    queue = new MemoryQueue();
    cache = new Cache({ service: "analytics", store: new MemoryCache(), defaultTtlSeconds: 60 });
    store.clear();

    queue.subscribe<{ id: string; queryName: string; tenantId: string; status: string }>(
      "analytics.query.run",
      async (msg) => {
        store.set(msg.payload.id, {
          id: msg.payload.id,
          queryName: msg.payload.queryName,
          tenantId: msg.payload.tenantId,
          status: "completed",
        });
      }
    );
  });

  it("runQuery primes cache and publishes command", async () => {
    const tenantId = "11111111-aaaa-4000-8000-000000000001";
    const id = "55555555-eeee-4000-8000-000000000005";
    const projected = { id, tenantId, queryName: "budget_summary", dashboardId: null, status: "running", resultRows: 0, version: 1 };

    await cache.put(cache.makeKey(tenantId, "query_run", id), projected);
    await queue.publish("analytics.query.run", {
      messageId: id,
      type: "analytics.query.run",
      tenantId,
      actorId: "00000000-aaaa-4000-8000-000000000001",
      correlationId: "c1",
      schemaVersion: "1.0",
      payload: projected,
    });

    expect(store.has(id)).toBe(false);
    const fromCache = await cache.getOrLoad(cache.makeKey(tenantId, "query_run", id), async () => null);
    expect(fromCache).toEqual(projected);

    await new Promise((r) => setTimeout(r, 20));
    expect(store.get(id)?.queryName).toBe("budget_summary");
    expect(store.get(id)?.status).toBe("completed");
  });

  it("listOrLoad caches paginated dashboard results", async () => {
    const tenantId = "11111111-aaaa-4000-8000-000000000003";
    const page = {
      data: [{ id: "db1", tenantId, name: "Finance KPIs", description: null, status: "active", version: 1 }],
      pagination: { hasMore: false, pageSize: 50 },
    };
    let loads = 0;
    const first = await cache.listOrLoad(tenantId, "dashboard", "list:50:0", async () => {
      loads++;
      return page;
    });
    const second = await cache.listOrLoad(tenantId, "dashboard", "list:50:0", async () => {
      loads++;
      return page;
    });
    expect(first).toEqual(page);
    expect(second).toEqual(page);
    expect(loads).toBe(1);
  });

  it("different tenants do not share cached dashboards", async () => {
    const tenantA = "aaaaaaaa-0000-4000-8000-000000000001";
    const tenantB = "bbbbbbbb-0000-4000-8000-000000000002";
    const id = "dddddddd-0000-4000-8000-000000000001";

    await cache.put(cache.makeKey(tenantA, "dashboard", id), { id, tenantId: tenantA, name: "Tenant A Board" });
    const fromB = await cache.getOrLoad(cache.makeKey(tenantB, "dashboard", id), async () => null);
    expect(fromB).toBeNull();
  });
});
