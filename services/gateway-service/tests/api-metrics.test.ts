/**
 * GAP-ADMIN-API-MONITORING-06: the gateway-side collector -- grouping, counting,
 * histogram buckets, bounded memory with counted drops, and that a failing
 * publish never throws into the request path.
 */
import { describe, it, expect, vi } from "vitest";
import Fastify from "fastify";
import { ApiMetricsCollector, INGEST_TOPIC, bucketIndex, classifyPath, registerApiMetrics } from "../src/api-metrics.js";

const T1 = "11111111-1111-4111-8111-111111111111";
const T2 = "22222222-2222-4222-8222-222222222222";
const NOW = Date.parse("2026-10-04T10:00:30Z");

type Env = { tenantId: string; messageId: string; payload: { rows: Array<Record<string, unknown>> } };
function setup(maxKeys = 5000) {
  const sent: Env[] = [];
  const publish = vi.fn(async (_t: string, e: Record<string, unknown>) => { sent.push(e as unknown as Env); });
  return { sent, publish, c: new ApiMetricsCollector(publish, maxKeys, () => NOW) };
}

describe("classifyPath", () => {
  it("groups by registered service and replaces ids", () => {
    expect(classifyPath("/api/v1/finance/invoices/3f2504e0-4f89-41d3-9a0c-0305e82c3301?x=1"))
      .toEqual({ service: "finance", endpoint: "/api/v1/finance/invoices/:id" });
    expect(classifyPath("/api/v1/hrms/employees/12345/leave")).toEqual({ service: "hrms", endpoint: "/api/v1/hrms/employees/:id/leave" });
    // depth is capped at three segments BELOW the service prefix, so invented path words cannot mint series
    expect(classifyPath("/api/v1/finance/a/b/c/d/e/f")).toEqual({ service: "finance", endpoint: "/api/v1/finance/a/b/c" });
    expect(classifyPath("/api/identity/a/b/c/d")).toEqual({ service: "identity", endpoint: "/api/identity/a/b/c" });
    expect(classifyPath("/api/identity/users")).toEqual({ service: "identity", endpoint: "/api/identity/users" });
  });
  it("buckets paths that match no registered route as 'other', so invented paths cannot mint series", () => {
    expect(classifyPath("/api/v1/does-not-exist/x")).toEqual({ service: "other", endpoint: "/other" });
    expect(classifyPath("/api/zzz-" + "a".repeat(50))).toEqual({ service: "other", endpoint: "/other" });
    expect(classifyPath("/api")).toEqual({ service: "other", endpoint: "/other" });
    // a prefix is not a substring match
    expect(classifyPath("/api/v1/financeX/anything")).toEqual({ service: "other", endpoint: "/other" });
  });
  it("ignores non-API paths", () => {
    expect(classifyPath("/metrics/prom")).toBeNull();
    expect(classifyPath("/health")).toBeNull();
  });
  it("buckets latency on the shared bounds", () => {
    expect(bucketIndex(0)).toBe(0);
    expect(bucketIndex(5)).toBe(0);
    expect(bucketIndex(6)).toBe(1);
    expect(bucketIndex(10_000)).toBe(10);
    expect(bucketIndex(10_001)).toBe(11);
  });
});

describe("ApiMetricsCollector", () => {
  it("counts requests, 4xx, 5xx and the latency histogram per tenant and endpoint, one command per tenant", async () => {
    const { c, sent } = setup();
    c.record(T1, "/api/v1/finance/invoices", 200, 30);
    c.record(T1, "/api/v1/finance/invoices", 404, 30);
    c.record(T1, "/api/v1/finance/invoices", 503, 6000);
    c.record(T2, "/api/v1/finance/invoices", 200, 1);
    await c.flush();
    expect(sent).toHaveLength(2);
    const a = sent.find((s) => s.tenantId === T1)!;
    expect(a.payload.rows).toHaveLength(1);
    expect(a.payload.rows[0]).toMatchObject({
      minute: "2026-10-04T10:00:00.000Z", service: "finance", endpoint: "/api/v1/finance/invoices",
      requests: 3, errors4xx: 1, errors5xx: 1, sumMs: 6060,
    });
    const b = a.payload.rows[0]!.buckets as number[];
    expect(b[3]).toBe(2);
    expect(b[10]).toBe(1);
    expect(b).toHaveLength(12);
    expect(c.size).toBe(0);
  });

  it("every flush carries a fresh messageId (a deterministic id would drop later batches)", async () => {
    const { c, sent } = setup();
    c.record(T1, "/api/v1/finance/b", 200, 1);
    await c.flush();
    c.record(T1, "/api/v1/finance/b", 200, 1);
    await c.flush();
    expect(new Set(sent.map((s) => s.messageId)).size).toBe(2);
    expect(sent.every((s) => s.payload.rows.length === 1)).toBe(true);
  });

  it("drops and counts requests once the table is full, but keeps counting existing keys", async () => {
    const { c, sent } = setup(2);
    c.record(T1, "/api/v1/finance/x", 200, 1);
    c.record(T1, "/api/v1/finance/y", 200, 1);
    c.record(T1, "/api/v1/finance/z", 200, 1); // third distinct key: dropped
    c.record(T1, "/api/v1/finance/x", 200, 1); // existing key: still counted
    expect(c.dropped).toBe(1);
    await c.flush();
    const rows = sent[0]!.payload.rows;
    expect(rows.find((r) => r.endpoint === "/api/v1/finance/x")!.requests).toBe(2);
    expect(rows.find((r) => r.endpoint === "/api/v1/finance/z")).toBeUndefined();
  });

  it("a failing publish is swallowed and its requests are counted as dropped", async () => {
    const publish = vi.fn(async () => { throw new Error("redis down"); });
    const c = new ApiMetricsCollector(publish, 10, () => NOW);
    c.record(T1, "/api/v1/finance/x", 200, 1);
    c.record(T1, "/api/v1/finance/x", 200, 1);
    await expect(c.flush()).resolves.toBeUndefined();
    expect(c.dropped).toBe(2);
    expect(c.size).toBe(0);
  });

  it("one tenant cannot fill the table: past its share, new endpoints fold into one overflow series", async () => {
    const sent: Env[] = [];
    const c = new ApiMetricsCollector(async (_t, e) => { sent.push(e as unknown as Env); }, 5000, () => NOW, 3);
    for (let i = 0; i < 50; i++) c.record(T1, `/api/v1/finance/junk${i}`, 404, 1);
    c.record(T2, "/api/v1/finance/real", 200, 1);
    expect(c.dropped).toBe(0);
    expect(c.size).toBe(3 + 1 + 1); // 3 own series + 1 overflow for T1, plus T2's series
    await c.flush();
    const t1 = sent.find((s) => s.tenantId === T1)!.payload.rows;
    expect(t1.map((r) => r.endpoint).sort()).toEqual(["/api/v1/finance/junk0", "/api/v1/finance/junk1", "/api/v1/finance/junk2", "/other"]);
    expect(t1.find((r) => r.endpoint === "/other")).toMatchObject({ requests: 47, errors4xx: 47 });
    expect(sent.some((s) => s.tenantId === T2)).toBe(true);
  });

  it("an unmatched path is recorded as the single 'other' series", async () => {
    const { c, sent } = setup();
    for (let i = 0; i < 20; i++) c.record(T1, `/api/v1/nope-${i}/x`, 404, 1);
    expect(c.size).toBe(1);
    await c.flush();
    expect(sent[0]!.payload.rows[0]).toMatchObject({ service: "other", endpoint: "/other", requests: 20 });
  });

  it("a flush that is still running is joined, not overlapped", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => { release = r; });
    const publish = vi.fn(async () => { await gate; });
    const c = new ApiMetricsCollector(publish, 10, () => NOW);
    c.record(T1, "/api/v1/finance/x", 200, 1);
    const first = c.flush();
    c.record(T1, "/api/v1/finance/y", 200, 1);
    const second = c.flush();
    expect(second).toBe(first);
    expect(publish).toHaveBeenCalledTimes(1);
    release();
    await first;
    await c.flush(); // the next tick picks up what was recorded meanwhile
    expect(publish).toHaveBeenCalledTimes(2);
  });

  it("an empty flush publishes nothing", async () => {
    const { c, publish } = setup();
    await c.flush();
    expect(publish).not.toHaveBeenCalled();
  });
});

describe("registerApiMetrics", () => {
  it("records only requests with a verified tenant, never the raw x-tenant-id header, and flushes on close", async () => {
    const { sent, publish } = setup();
    const app = Fastify();
    // Simulates what jwtEdgeVerify sets for a verified token.
    app.addHook("onRequest", async (req) => {
      if (req.headers["x-test-tid"]) (req as unknown as { jwtPayload: { tid: string } }).jwtPayload = { tid: String(req.headers["x-test-tid"]) };
    });
    const collector = registerApiMetrics(app, publish);
    expect(collector).not.toBeNull();
    app.get("/api/v1/finance/ping", async () => ({ ok: true }));
    await app.inject({ method: "GET", url: "/api/v1/finance/ping", headers: { "x-test-tid": T1 } });
    // a spoofed header with no verified identity must not be attributed to any tenant
    await app.inject({ method: "GET", url: "/api/v1/finance/ping", headers: { "x-tenant-id": T2 } });
    await app.close();
    expect(publish).toHaveBeenCalledTimes(1);
    expect(publish.mock.calls[0]![0]).toBe(INGEST_TOPIC);
    expect(sent[0]!.tenantId).toBe(T1);
    expect(sent[0]!.payload.rows[0]).toMatchObject({ requests: 1, service: "finance" });
  });
});
