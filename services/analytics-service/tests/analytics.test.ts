/**
 * analytics-service unit tests — validators + CQRS wiring (MemoryQueue + MemoryCache).
 * No Postgres/Redis required.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { MemoryQueue } from "@civitasone/queue";
import { Cache, MemoryCache } from "@civitasone/cache";
import { dashboardViewSchema, dashboardsListSchema, addWidgetBody, updateDashboardBody } from "../src/modules/dashboards/validators.js";
import { runQueryBody, scheduleQueryBody, createExportBody } from "../src/modules/queries/validators.js";
import { saveMetricBody } from "../src/modules/metrics/validators.js";

describe("dashboard validators", () => {
  it("validates a dashboard view with access-control fields", () => {
    const view = dashboardViewSchema.parse({
      id: "11111111-aaaa-4000-8000-000000000001",
      tenantId: "22222222-bbbb-4000-8000-000000000002",
      name: "Finance Overview",
      description: "Monthly finance metrics",
      status: "active",
      ownerId: "33333333-cccc-4000-8000-000000000003",
      visibility: "shared",
      layout: { columns: 2 },
      version: 1,
    });
    expect(view.visibility).toBe("shared");
  });

  it("validates paginated dashboards list", () => {
    const list = dashboardsListSchema.parse({ data: [], pagination: { hasMore: false, pageSize: 50 } });
    expect(list.data).toHaveLength(0);
  });

  it("requires an expectedVersion for optimistic-locked updates", () => {
    expect(() => updateDashboardBody.parse({ name: "x" })).toThrow();
    const ok = updateDashboardBody.parse({ name: "x", expectedVersion: 3 });
    expect(ok.expectedVersion).toBe(3);
  });

  it("widget add requires a registry-valid spec", () => {
    const ok = addWidgetBody.parse({
      title: "Spend by source",
      vizType: "bar",
      spec: { metric: "amount_sum", dimensions: ["source"] },
    });
    expect(ok.vizType).toBe("bar");
    expect(() => addWidgetBody.parse({ title: "bad", spec: { metric: "nope" } })).toThrow();
  });
});

describe("query/scheduled/export validators", () => {
  it("run query requires a structured spec (there is no raw SQL field)", () => {
    const ok = runQueryBody.parse({ queryName: "budget_summary", spec: { metric: "event_count" } });
    expect(ok.queryName).toBe("budget_summary");
    expect(() => runQueryBody.parse({ queryName: "x" })).toThrow(); // missing spec
    expect(() => runQueryBody.parse({ queryName: "x", sql: "SELECT 1" } as never)).toThrow();
  });

  it("schedule query accepts a cadence", () => {
    const ok = scheduleQueryBody.parse({ name: "daily spend", spec: { metric: "amount_sum" }, cadence: "weekly" });
    expect(ok.cadence).toBe("weekly");
  });

  it("export requires a query run id and a known format", () => {
    const ok = createExportBody.parse({ queryRunId: "44444444-dddd-4000-8000-000000000004", format: "csv" });
    expect(ok.format).toBe("csv");
    expect(() => createExportBody.parse({ queryRunId: "not-a-uuid" })).toThrow();
  });
});

describe("saved metric validators", () => {
  it("rejects a spec whose metric does not match the declared metricKey", () => {
    expect(() =>
      saveMetricBody.parse({ name: "m", metricKey: "amount_sum", spec: { metric: "event_count" } }),
    ).toThrow();
  });

  it("accepts a consistent saved metric", () => {
    const ok = saveMetricBody.parse({
      name: "Total spend",
      metricKey: "amount_sum",
      spec: { metric: "amount_sum", dimensions: ["source"] },
    });
    expect(ok.name).toBe("Total spend");
  });
});

describe("write-via-queue + read-via-cache", () => {
  let queue: MemoryQueue;
  let cache: Cache;
  const store = new Map<string, { id: string; tenantId: string; status: string }>();

  beforeEach(() => {
    queue = new MemoryQueue();
    cache = new Cache({ service: "analytics", store: new MemoryCache(), defaultTtlSeconds: 60 });
    store.clear();
    queue.subscribe<{ id: string; tenantId: string; status: string }>("analytics.query.run", async (msg) => {
      store.set(msg.payload.id, { id: msg.payload.id, tenantId: msg.payload.tenantId, status: "completed" });
    });
  });

  it("primes cache and publishes the run command", async () => {
    const tenantId = "11111111-aaaa-4000-8000-000000000001";
    const id = "55555555-eeee-4000-8000-000000000005";
    const projected = { id, tenantId, queryName: "q", status: "running" };
    await cache.put(cache.makeKey(tenantId, "query_run", id), projected);
    await queue.publish("analytics.query.run", {
      messageId: id, type: "analytics.query.run", tenantId,
      actorId: "00000000-aaaa-4000-8000-000000000001", correlationId: "c1", schemaVersion: "1.0", payload: projected,
    });
    const fromCache = await cache.getOrLoad(cache.makeKey(tenantId, "query_run", id), async () => null);
    expect(fromCache).toEqual(projected);
    await new Promise((r) => setTimeout(r, 20));
    expect(store.get(id)?.status).toBe("completed");
  });

  it("different tenants never share cached entries", async () => {
    const tenantA = "aaaaaaaa-0000-4000-8000-000000000001";
    const tenantB = "bbbbbbbb-0000-4000-8000-000000000002";
    const id = "dddddddd-0000-4000-8000-000000000001";
    await cache.put(cache.makeKey(tenantA, "dashboard", id), { id, tenantId: tenantA, name: "A" });
    const fromB = await cache.getOrLoad(cache.makeKey(tenantB, "dashboard", id), async () => null);
    expect(fromB).toBeNull();
  });
});
