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
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { registerApiMonitoringConsumers } from "../src/modules/api-monitoring/consumer.js";
import * as repo from "../src/modules/api-monitoring/repo.js";
import {
  endpointStatus, errorRatePct, percentileFromBuckets, rollupEndpoints, toApiRow, clampRetentionDays,
  LATENCY_BUCKET_COUNT,
} from "../src/modules/api-monitoring/domain.js";
import { COMMANDS } from "../src/topics.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const T_A = "aaaaaaaa-0046-4000-8000-000000000001";
const T_B = "bbbbbbbb-0046-4000-8000-000000000002";
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

const row = (over: Partial<Row> = {}): Row => ({
  minute: minuteIso(1), service: "finance", endpoint: "/api/v1/finance/invoices", requests: 10,
  errors4xx: 1, errors5xx: 0, sumMs: 400, buckets: buckets({ 3: 6, 4: 4 }), ...over,
});

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
  for (const t of [T_A, T_B]) {
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
    await ingest(T_A, [row({ endpoint: "/api/v1/finance/future", minute: new Date(Date.now() + 3_600_000).toISOString() })]);
    const rows = await asTenant(T_A, (q) => q`SELECT 1 FROM health.api_metrics_minute WHERE tenant_id = ${T_A} AND endpoint IN ('/api/v1/finance/bad', '/api/v1/finance/future')`);
    expect(rows).toHaveLength(0);
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
