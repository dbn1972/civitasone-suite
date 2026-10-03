/**
 * GAP-ADMIN-API-MONITORING-06: the in-house metrics rollup behind
 * GET /v1/admin/api-monitoring -- additive ingest, histogram percentiles, tenant
 * isolation, platform-wide reads, per-tenant retention. Real Postgres, real RLS,
 * non-superuser role.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { runWithTenant } from "@civitasone/db";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { registerApiMonitoringConsumers, foldedRowCount, endpointCacheLoads, endpointSeenQueries, resetEndpointCache, setEndpointClock } from "../src/modules/api-monitoring/consumer.js";
import * as repo from "../src/modules/api-monitoring/repo.js";
import {
  endpointStatus, errorRatePct, percentileFromBuckets, rollupEndpoints, toApiRow, clampRetentionDays,
  LATENCY_BUCKET_COUNT,
} from "../src/modules/api-monitoring/domain.js";
import { COMMANDS } from "../src/topics.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const T_A = "aaaaaaaa-0046-4000-8000-000000000001";
const T_B = "bbbbbbbb-0046-4000-8000-000000000002";
const T_C = "cccccccc-0046-4000-8000-000000000003";
const ACTOR = "aaaaaaaa-0046-4000-8000-0000000000a1";

const hdr = (tid: string, roles: string[]) => ({
  authorization: `Bearer ${signToken({ sub: ACTOR, tid, roles, sid: "sess-api-metrics" }, SECRET, 3600)}`,
});

let app: FastifyInstance;
const drain = () => (queue as unknown as { drain?: () => Promise<void> }).drain?.();

function buckets(over: Partial<Record<number, number>> = {}): number[] {
  const b = new Array<number>(LATENCY_BUCKET_COUNT).fill(0);
  for (const [i, n] of Object.entries(over)) b[Number(i)] = n as number;
  return b;
}

function minuteIso(minutesAgo: number): string {
  const d = new Date(Math.floor(Date.now() / 60_000) * 60_000 - minutesAgo * 60_000);
  return d.toISOString();
}

type Row = { minute: string; service: string; endpoint: string; requests: number; errors4xx: number; errors5xx: number; sumMs: number; buckets: number[] };

async function ingest(tenantId: string, rows: Row[], messageId: string = randomUUID()): Promise<void> {
  await queue.publish(COMMANDS.apiMetricsIngest, {
    messageId, type: COMMANDS.apiMetricsIngest, tenantId, actorId: ACTOR,
    correlationId: randomUUID(), schemaVersion: "1.0", payload: { rows },
  });
  await drain();
}

// The histogram must add up to the request count (the consumer rejects inconsistent rows), so by default
// it follows `requests`.
const row = (over: Partial<Row> = {}): Row => {
  const requests = over.requests ?? 10;
  return {
    minute: minuteIso(1), service: "finance", endpoint: "/api/v1/finance/invoices", requests,
    errors4xx: 1, errors5xx: 0, sumMs: requests * 40, buckets: buckets({ 3: requests }), ...over,
  };
};

async function get(tid: string, roles: string[], qs = "") {
  return app.inject({ method: "GET", url: `/v1/admin/api-monitoring${qs}`, headers: hdr(tid, roles) });
}

/** Raw SQL under the tenant GUC: the service role is NOBYPASSRLS, so an un-scoped statement sees zero rows. */
async function asTenant<T>(tenantId: string, fn: (q: typeof sqlClient) => Promise<T>): Promise<T> {
  return (await sqlClient.begin(async (q) => {
    await q`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
    return fn(q as unknown as typeof sqlClient);
  })) as T;
}

async function wipe() {
  resetEndpointCache();
  for (const t of [T_A, T_B, T_C]) {
    await asTenant(t, async (q) => {
      await q`DELETE FROM health.api_metrics_minute WHERE tenant_id = ${t}`;
      await q`DELETE FROM health.api_metrics_settings WHERE tenant_id = ${t}`;
    });
  }
}

beforeAll(async () => {
  registerApiMonitoringConsumers(queue);
  await queue.start();
  app = await buildApp();
  await wipe();
});
afterAll(async () => { await wipe(); await app.close(); await queue.stop(); await sqlClient.end(); });

describe("domain", () => {
  it("interpolates percentiles from the histogram and reports null with no samples", () => {
    expect(percentileFromBuckets(buckets(), 0.5)).toBeNull();
    // 10 samples all in the (25, 50] bucket: p50 sits mid-bucket, p95 near the top.
    expect(percentileFromBuckets(buckets({ 3: 10 }), 0.5)).toBe(38);
    expect(percentileFromBuckets(buckets({ 3: 10 }), 0.95)).toBe(49);
    // The overflow bucket is reported at its lower bound, never invented.
    expect(percentileFromBuckets(buckets({ 11: 5 }), 0.95)).toBe(10000);
  });
  it("error rate is the 5xx percent; status thresholds follow it", () => {
    expect(errorRatePct(1, 8)).toBe(12.5);
    expect(errorRatePct(0, 0)).toBe(0);
    expect(endpointStatus(0, 100)).toBe("healthy");
    expect(endpointStatus(5, 100)).toBe("degraded");
    expect(endpointStatus(50, 100)).toBe("down");
  });
  it("rolls minutes up per endpoint and exposes the contract the web table reads", () => {
    const t = new Date("2026-10-01T10:00:00Z");
    const r = rollupEndpoints([
      { bucketMinute: t, service: "a", endpoint: "/x", requests: 10, errors4xx: 1, errors5xx: 1, latencySumMs: 100, latencyBuckets: buckets({ 2: 10 }) },
      { bucketMinute: new Date(t.getTime() + 60_000), service: "a", endpoint: "/x", requests: 10, errors4xx: 0, errors5xx: 1, latencySumMs: 100, latencyBuckets: buckets({ 2: 10 }) },
    ]);
    expect(r).toHaveLength(1);
    const api = toApiRow(r[0]!, 10);
    expect(api).toMatchObject({ service: "a", endpoint: "/x", requests: 20, errorRate: 10, requestsPerMin: 2, status: "degraded" });
    expect(api.lastRequestAt).toBe("2026-10-01T10:02:00.000Z");
    expect(clampRetentionDays(0)).toBe(1);
    expect(clampRetentionDays(9999)).toBe(365);
  });
});

describe("ingest", () => {
  it("adds batches for the same minute together (several gateway pods) and merges the histogram", async () => {
    await ingest(T_A, [row({ endpoint: "/api/v1/finance/add", requests: 10, errors5xx: 1, buckets: buckets({ 3: 10 }) })]);
    await ingest(T_A, [row({ endpoint: "/api/v1/finance/add", requests: 5, errors5xx: 2, buckets: buckets({ 3: 2, 5: 3 }) })]);
    const [r] = await asTenant(T_A, (q) => q<Array<{ requests: number; errors_5xx: number; latency_buckets: number[] }>>`
      SELECT requests, errors_5xx, latency_buckets FROM health.api_metrics_minute
      WHERE tenant_id = ${T_A} AND endpoint = '/api/v1/finance/add'`);
    expect(r).toMatchObject({ requests: 15, errors_5xx: 3 });
    expect(r!.latency_buckets[3]).toBe(12);
    expect(r!.latency_buckets[5]).toBe(3);
  });

  it("a redelivered message is applied once", async () => {
    const id = randomUUID();
    const r = row({ endpoint: "/api/v1/finance/replay", requests: 7 });
    await ingest(T_A, [r], id);
    await ingest(T_A, [r], id);
    const [c] = await asTenant(T_A, (q) => q<Array<{ requests: number }>>`
      SELECT requests FROM health.api_metrics_minute WHERE tenant_id = ${T_A} AND endpoint = '/api/v1/finance/replay'`);
    expect(c!.requests).toBe(7);
  });

  it("drops a malformed batch and minutes from the future instead of failing", async () => {
    await ingest(T_A, [row({ endpoint: "/api/v1/finance/bad", buckets: [1, 2, 3] })]);
    // inconsistent counts: more errors than requests, and a histogram that does not add up to the requests
    await ingest(T_A, [row({ endpoint: "/api/v1/finance/bad", requests: 5, errors4xx: 4, errors5xx: 4, buckets: buckets({ 3: 5 }) })]);
    await ingest(T_A, [row({ endpoint: "/api/v1/finance/bad", requests: 5, errors4xx: 0, errors5xx: 0, buckets: buckets({ 3: 4 }) })]);
    await ingest(T_A, [row({ endpoint: "/api/v1/finance/future", minute: new Date(Date.now() + 3_600_000).toISOString() })]);
    const rows = await asTenant(T_A, (q) => q`SELECT 1 FROM health.api_metrics_minute WHERE tenant_id = ${T_A} AND endpoint IN ('/api/v1/finance/bad', '/api/v1/finance/future')`);
    expect(rows).toHaveLength(0);
  });
});

describe("ingest: one bad row does not discard the rest of the batch", () => {
  it("applies the good rows and skips the inconsistent one", async () => {
    await ingest(T_A, [
      row({ endpoint: "/api/v1/finance/good-one", requests: 3, errors4xx: 0, errors5xx: 0, buckets: buckets({ 2: 3 }) }),
      row({ endpoint: "/api/v1/finance/bad-one", requests: 3, errors4xx: 5, errors5xx: 0, buckets: buckets({ 2: 3 }) }),
    ]);
    const got = await asTenant(T_A, (q) => q<Array<{ endpoint: string }>>`SELECT endpoint FROM health.api_metrics_minute WHERE tenant_id = ${T_A} AND endpoint IN ('/api/v1/finance/good-one', '/api/v1/finance/bad-one')`);
    expect(got.map((g) => g.endpoint)).toEqual(["/api/v1/finance/good-one"]);
  });
});

describe("ingest: the seen-endpoint cache", () => {
  const withCap = async (n: string, fn: () => Promise<void>) => {
    const prev = process.env.API_METRICS_MAX_ENDPOINTS_PER_TENANT_DAY;
    process.env.API_METRICS_MAX_ENDPOINTS_PER_TENANT_DAY = n;
    try { await fn(); } finally { if (prev === undefined) delete process.env.API_METRICS_MAX_ENDPOINTS_PER_TENANT_DAY; else process.env.API_METRICS_MAX_ENDPOINTS_PER_TENANT_DAY = prev; }
  };
  const endpointsOf = (t: string) => asTenant(t, async (q) => (await q<Array<{ service: string; endpoint: string }>>`
    SELECT DISTINCT service, endpoint FROM health.api_metrics_minute WHERE tenant_id = ${t} ORDER BY service, endpoint`).map((r) => `${r.service} ${r.endpoint}`));

  it("loads the day's endpoints once per tenant, not on every message, and learns new ones as it stores them", async () => {
    await wipe();
    await withCap("3", async () => {
      const before = endpointCacheLoads();
      await ingest(T_C, [row({ endpoint: "/api/v1/finance/c1" })]);
      await ingest(T_C, [row({ endpoint: "/api/v1/finance/c2" })]);
      await ingest(T_C, [row({ endpoint: "/api/v1/finance/c3" })]);
      expect(endpointCacheLoads() - before).toBe(1);
      // the cache learned c1-c3 from its own inserts: the cap (3) is reached without another database read
      await ingest(T_C, [row({ endpoint: "/api/v1/finance/c4" }), row({ endpoint: "/api/v1/finance/c1" })]);
      expect(endpointCacheLoads() - before).toBe(1);
      expect(await endpointsOf(T_C)).toEqual(["finance /api/v1/finance/c1", "finance /api/v1/finance/c2", "finance /api/v1/finance/c3", "other /other"]);
    });
  });

  it("never folds an endpoint another process already recorded, even when this process's cache has not seen it", async () => {
    await wipe();
    await withCap("2", async () => {
      await ingest(T_C, [row({ endpoint: "/api/v1/finance/d1" }), row({ endpoint: "/api/v1/finance/d2" })]); // cache: d1, d2 (cap reached)
      // "another process" records d3 directly (the cap is soft across processes)
      await asTenant(T_C, async (q) => {
        await q`INSERT INTO health.api_metrics_minute (tenant_id, bucket_minute, service, endpoint, requests, latency_buckets)
                VALUES (${T_C}, date_trunc('minute', now()), 'finance', '/api/v1/finance/d3', 1, ${buckets({ 3: 1 })})`;
      });
      await ingest(T_C, [row({ endpoint: "/api/v1/finance/d3", requests: 4 }), row({ endpoint: "/api/v1/finance/d4", requests: 6 })]);
      const got = await asTenant(T_C, (q) => q<Array<{ endpoint: string; n: number }>>`
        SELECT service || ' ' || endpoint AS endpoint, sum(requests)::int AS n FROM health.api_metrics_minute WHERE tenant_id = ${T_C} GROUP BY 1 ORDER BY 1`);
      expect(Object.fromEntries(got.map((g) => [g.endpoint, g.n]))).toEqual({
        "finance /api/v1/finance/d1": 10, "finance /api/v1/finance/d2": 10,
        "finance /api/v1/finance/d3": 5,   // 1 from the other process + 4 here: NOT folded
        "other /other": 6,                  // d4 is genuinely new and over the cap
      });
    });
  });

  it("folding many invented endpoints in ONE message costs at most one database read of the day's set", async () => {
    await wipe();
    await withCap("2", async () => {
      await ingest(T_C, [row({ endpoint: "/api/v1/finance/g1" }), row({ endpoint: "/api/v1/finance/g2" })]); // cache warm and at the cap
      const before = endpointSeenQueries();
      const junk = Array.from({ length: 60 }, (_, n) => row({ endpoint: `/api/v1/finance/junk-${n}`, requests: 2 }));
      await ingest(T_C, junk);
      expect(endpointSeenQueries() - before).toBeLessThanOrEqual(1);
      // and a second message of junk (cache unchanged by the folded rows) is again one read, not 60
      const mid = endpointSeenQueries();
      await ingest(T_C, junk.map((r, n) => ({ ...r, endpoint: `/api/v1/finance/more-${n}` })));
      expect(endpointSeenQueries() - mid).toBeLessThanOrEqual(1);
      expect(await endpointsOf(T_C)).toEqual(["finance /api/v1/finance/g1", "finance /api/v1/finance/g2", "other /other"]);
      const other = await asTenant(T_C, (q) => q<Array<{ n: number }>>`SELECT sum(requests)::int AS n FROM health.api_metrics_minute WHERE tenant_id = ${T_C} AND service = 'other'`);
      expect(other[0]!.n).toBe(240);
    });
  });

  it("a message with no over-cap endpoints reads the day's set zero times once the cache is warm", async () => {
    await wipe();
    await withCap("5", async () => {
      await ingest(T_C, [row({ endpoint: "/api/v1/finance/h1" })]);
      const before = endpointSeenQueries();
      await ingest(T_C, [row({ endpoint: "/api/v1/finance/h2" }), row({ endpoint: "/api/v1/finance/h1" })]);
      expect(endpointSeenQueries() - before).toBe(0);
    });
  });

  it("a rolled-back batch teaches the cache nothing, and a new UTC day reloads it", async () => {
    await wipe();
    await withCap("2", async () => {
      await ingest(T_C, [row({ endpoint: "/api/v1/finance/f1" })]);
      // an invalid batch never reaches the cache
      await ingest(T_C, [row({ endpoint: "/api/v1/finance/f2", buckets: [1] })]);
      await ingest(T_C, [row({ endpoint: "/api/v1/finance/f3" }), row({ endpoint: "/api/v1/finance/f4" })]);
      expect(await endpointsOf(T_C)).toEqual(["finance /api/v1/finance/f1", "finance /api/v1/finance/f3", "other /other"]);
      // tomorrow the tenant starts again with an empty set: the cache is reloaded, f4 is admitted
      const before = endpointCacheLoads();
      setEndpointClock(() => new Date(Date.now() + 86_400_000 + 60_000));
      try {
        await ingest(T_C, [row({ endpoint: "/api/v1/finance/f4" })]);
        expect(endpointCacheLoads() - before).toBe(1);
        // admitted under its own name, not folded: the new day's set was empty
        expect(await endpointsOf(T_C)).toContain("finance /api/v1/finance/f4");
      } finally { setEndpointClock(null); }
    });
  });
});

describe("ingest: per-tenant daily endpoint cap", () => {
  it("folds endpoints over the cap into 'other', counts them, and keeps feeding endpoints already seen", async () => {
    await wipe();
    const prev = process.env.API_METRICS_MAX_ENDPOINTS_PER_TENANT_DAY;
    process.env.API_METRICS_MAX_ENDPOINTS_PER_TENANT_DAY = "3";
    try {
      const before = foldedRowCount();
      await ingest(T_C, [1, 2, 3, 4, 5].map((n) => row({ endpoint: `/api/v1/finance/e${n}`, requests: 2 })));
      // a later batch: a known endpoint still accumulates, a fresh one is folded
      await ingest(T_C, [row({ endpoint: "/api/v1/finance/e1", requests: 3 }), row({ endpoint: "/api/v1/finance/e9", requests: 4 })]);
      const got = await asTenant(T_C, (q) => q<Array<{ service: string; endpoint: string; n: number }>>`
        SELECT service, endpoint, sum(requests)::int AS n FROM health.api_metrics_minute WHERE tenant_id = ${T_C} GROUP BY service, endpoint ORDER BY service, endpoint`);
      const byKey = Object.fromEntries(got.map((g) => [`${g.service} ${g.endpoint}`, g.n]));
      expect(byKey).toEqual({
        "finance /api/v1/finance/e1": 5,
        "finance /api/v1/finance/e2": 2,
        "finance /api/v1/finance/e3": 2,
        "other /other": 2 + 2 + 4,
      });
      expect(foldedRowCount() - before).toBe(3);
    } finally {
      if (prev === undefined) delete process.env.API_METRICS_MAX_ENDPOINTS_PER_TENANT_DAY; else process.env.API_METRICS_MAX_ENDPOINTS_PER_TENANT_DAY = prev;
    }
  });

  it("never lets the 'other' series itself be refused, and does not affect another tenant", async () => {
    const prev = process.env.API_METRICS_MAX_ENDPOINTS_PER_TENANT_DAY;
    process.env.API_METRICS_MAX_ENDPOINTS_PER_TENANT_DAY = "1";
    try {
      await ingest(T_B, [row({ endpoint: "/api/v1/finance/b1" }), row({ service: "other", endpoint: "/other", requests: 5 })]);
      const got = await asTenant(T_B, (q) => q<Array<{ endpoint: string }>>`SELECT endpoint FROM health.api_metrics_minute WHERE tenant_id = ${T_B} ORDER BY endpoint`);
      expect(got.map((g) => g.endpoint)).toEqual(["/api/v1/finance/b1", "/other"]);
    } finally {
      if (prev === undefined) delete process.env.API_METRICS_MAX_ENDPOINTS_PER_TENANT_DAY; else process.env.API_METRICS_MAX_ENDPOINTS_PER_TENANT_DAY = prev;
    }
  });
});

describe("rollup read: histogram only for the endpoints kept", () => {
  it("returns the busiest endpoints with their own histograms and flags truncation", async () => {
    await wipe();
    await ingest(T_C, [
      row({ endpoint: "/api/v1/finance/r-big", requests: 50, errors4xx: 0, buckets: buckets({ 2: 50 }) }),
      row({ endpoint: "/api/v1/finance/r-mid", requests: 20, errors4xx: 0, buckets: buckets({ 6: 20 }) }),
      row({ endpoint: "/api/v1/finance/r-small", requests: 5, errors4xx: 0, buckets: buckets({ 9: 5 }) }),
    ]);
    // outside a request there is no ambient tenant: scope the read the way the route's onRequest hook does
    const r = await runWithTenant(T_C, () => repo.readOwnRollup(T_C, new Date(Date.now() - 3_600_000), 2));
    expect(r.truncated).toBe(true);
    expect(r.rollups.map((x) => x.endpoint)).toEqual(["/api/v1/finance/r-big", "/api/v1/finance/r-mid"]);
    expect(r.rollups[0]!.buckets[2]).toBe(50);
    expect(r.rollups[1]!.buckets[6]).toBe(20);
    expect(r.rollups.every((x) => x.buckets[9] === 0)).toBe(true);
    const all = await runWithTenant(T_C, () => repo.readOwnRollup(T_C, new Date(Date.now() - 3_600_000), 100));
    expect(all.truncated).toBe(false);
  });
});

describe("GET /v1/admin/api-monitoring", () => {
  beforeAll(async () => {
    await wipe();
    await ingest(T_A, [
      row({ endpoint: "/api/v1/finance/invoices", requests: 20, errors5xx: 2, buckets: buckets({ 3: 20 }) }),
      row({ endpoint: "/api/v1/hr/employees", service: "hrms", requests: 4, errors5xx: 0, buckets: buckets({ 2: 4 }) }),
      // outside the default 15 minute window
      row({ endpoint: "/api/v1/finance/old", minute: minuteIso(120), requests: 99 }),
    ]);
    await ingest(T_B, [row({ endpoint: "/api/v1/finance/invoices", requests: 1000, errors5xx: 900, buckets: buckets({ 8: 1000 }) })]);
  });

  it("403 for a caller without an admin role", async () => {
    expect((await get(T_A, ["employee"])).statusCode).toBe(403);
  });

  it("a tenant admin reads only their own tenant, in the contract the table expects", async () => {
    const res = await get(T_A, ["tenant_admin"]);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    const rows = body.data as Array<Record<string, unknown>>;
    expect(rows.map((r) => r.endpoint)).toEqual(["/api/v1/finance/invoices", "/api/v1/hr/employees"]);
    const inv = rows[0]!;
    expect(inv).toMatchObject({ service: "finance", requests: 20, errorRate: 10, status: "degraded" });
    expect(typeof inv.p95Latency).toBe("number");
    expect(typeof body.generatedAt).toBe("string");
    expect(body.meta).toMatchObject({ windowMinutes: 15, scope: "tenant", tenantId: T_A, retentionDays: 30 });
    // tenant B's 1000 requests never appear
    expect(JSON.stringify(body)).not.toContain("1000");
  });

  it("a wider window includes older minutes", async () => {
    const res = await get(T_A, ["tenant_admin"], "?windowMinutes=240");
    expect((res.json().data as Array<{ endpoint: string }>).map((r) => r.endpoint)).toContain("/api/v1/finance/old");
  });

  it("a tenant admin cannot read another tenant or the whole platform", async () => {
    expect((await get(T_A, ["tenant_admin"], `?tenantId=${T_B}`)).statusCode).toBe(403);
    expect((await get(T_A, ["tenant_admin"], "?scope=all")).statusCode).toBe(403);
  });

  it("a platform super-admin can read one other tenant or all of them", async () => {
    const other = await get(T_A, ["super_admin"], `?tenantId=${T_B}`);
    expect(other.statusCode).toBe(200);
    const rowsB = other.json().data as Array<{ requests: number; status: string }>;
    expect(rowsB).toHaveLength(1);
    expect(rowsB[0]).toMatchObject({ requests: 1000, status: "down" });

    const all = await get(T_A, ["platform_admin"], "?scope=all");
    const inv = (all.json().data as Array<{ endpoint: string; requests: number }>).find((r) => r.endpoint === "/api/v1/finance/invoices")!;
    expect(inv.requests).toBe(1020);
    expect(all.json().meta).toMatchObject({ scope: "all", tenantId: null });
  });

  it("aggregates in SQL: many minutes of one endpoint collapse to one row with the newest data included", async () => {
    const many: Row[] = [];
    for (let m = 0; m < 120; m++) many.push(row({ endpoint: "/api/v1/finance/long-run", minute: minuteIso(m + 1), requests: 2, errors4xx: 0, errors5xx: m === 0 ? 2 : 0, buckets: buckets({ 3: 2 }) }));
    await ingest(T_A, many);
    const res = await get(T_A, ["tenant_admin"], "?windowMinutes=240");
    const r = (res.json().data as Array<{ endpoint: string; requests: number; errorRate: number }>).find((x) => x.endpoint === "/api/v1/finance/long-run")!;
    expect(r.requests).toBe(240);
    // the 5xx came from the NEWEST minute: it must be counted (2 of 240)
    expect(r.errorRate).toBeCloseTo(0.83, 2);
    expect(res.json().meta.truncated).toBe(false);
  });

  it("400 for a bad window", async () => {
    expect((await get(T_A, ["tenant_admin"], "?windowMinutes=0")).statusCode).toBe(400);
    expect((await get(T_A, ["tenant_admin"], "?windowMinutes=100000")).statusCode).toBe(400);
  });
});

describe("retention", () => {
  it("is set through a command, audited, and read back", async () => {
    expect((await app.inject({ method: "PUT", url: "/v1/admin/api-monitoring/retention", headers: hdr(T_A, ["employee"]), payload: { retentionDays: 7 } })).statusCode).toBe(403);
    expect((await app.inject({ method: "PUT", url: "/v1/admin/api-monitoring/retention", headers: hdr(T_A, ["tenant_admin"]), payload: { retentionDays: 0 } })).statusCode).toBe(400);
    expect((await app.inject({ method: "PUT", url: "/v1/admin/api-monitoring/retention", headers: hdr(T_A, ["tenant_admin"]), payload: { retentionDays: 366 } })).statusCode).toBe(400);
    const ok = await app.inject({ method: "PUT", url: "/v1/admin/api-monitoring/retention", headers: hdr(T_A, ["tenant_admin"]), payload: { retentionDays: 7 } });
    expect(ok.statusCode).toBe(202);
    await drain();
    const got = await app.inject({ method: "GET", url: "/v1/admin/api-monitoring/retention", headers: hdr(T_A, ["tenant_admin"]) });
    expect(got.json().data.retentionDays).toBe(7);
    const audits = await sqlClient<Array<{ payload: unknown }>>`
      SELECT payload FROM _outbox.messages WHERE tenant_id = ${T_A} AND topic = 'audit.event.record'`;
    const mine = audits.map((a) => (typeof a.payload === "string" ? JSON.parse(a.payload) : a.payload) as Record<string, unknown>)
      .filter((p) => p.resourceType === "api_metrics_retention");
    expect(mine.length).toBeGreaterThan(0);
    expect(mine.at(-1)).toMatchObject({ action: "update", retentionDays: 7 });
  });

  it("the purge honours each tenant's own retention and keeps recent rows", async () => {
    await wipe();
    const old10 = row({ endpoint: "/api/v1/p/ten-days", minute: minuteIso(10 * 24 * 60) });
    const old40 = row({ endpoint: "/api/v1/p/forty-days", minute: minuteIso(40 * 24 * 60) });
    const fresh = row({ endpoint: "/api/v1/p/fresh", minute: minuteIso(5) });
    await ingest(T_A, [old10, old40, fresh]);
    await ingest(T_B, [old10, old40, fresh]);
    // T_A keeps 7 days; T_B uses the 30 day default.
    await app.inject({ method: "PUT", url: "/v1/admin/api-monitoring/retention", headers: hdr(T_A, ["tenant_admin"]), payload: { retentionDays: 7 } });
    await drain();
    const r = await repo.purgeExpired();
    expect(r.deleted).toBeGreaterThanOrEqual(3);
    const left = async (t: string) => (await asTenant(t, (q) => q<Array<{ endpoint: string }>>`SELECT endpoint FROM health.api_metrics_minute WHERE tenant_id = ${t} ORDER BY endpoint`)).map((x) => x.endpoint);
    expect(await left(T_A)).toEqual(["/api/v1/p/fresh"]);
    expect(await left(T_B)).toEqual(["/api/v1/p/fresh", "/api/v1/p/ten-days"]);
  });
});
