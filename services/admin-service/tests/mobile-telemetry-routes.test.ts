/**
 * CR-MOB-01 — mobile telemetry route integration tests.
 *
 * The ingest body is attacker-controlled, so the emphasis is on rejection:
 * every numeric ceiling, the clock window, arithmetic consistency and duplicate
 * screens must produce a 4xx, never a stored row. The aggregate views are
 * admin-only and must stay tenant-scoped.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";

const { buildApp } = await import("../src/app.js");
const { sqlClient } = await import("../src/shared/db.js");
const { queue } = await import("../src/shared/infra.js");
const { tenantScoped } = await import("../src/shared/tenant-queue.js");
const { registerMobileTelemetryConsumers } = await import("../src/modules/health/mobile-consumer.js");

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";

const T_MAIN = "4d000000-0000-4000-8000-0000000000d1";
const T_ALT = "4d000000-0000-4000-8000-0000000000d2";
const TENANTS = [T_MAIN, T_ALT];
const ACTOR = "4d111111-0000-4000-8000-000000000001";

function auth(roles: string[] = ["tenant_admin"], tenantId = T_MAIN): { authorization: string } {
  return { authorization: `Bearer ${signToken({ sub: ACTOR, tid: tenantId, roles, sid: "sess-mob" }, SECRET, 3600)}` };
}

function asTenant<T>(tenantId: string, run: (sql: typeof sqlClient) => Promise<T>): Promise<T> {
  return sqlClient.begin(async (sql) => {
    await sql`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
    return run(sql as typeof sqlClient);
  }) as Promise<T>;
}

async function wipe(): Promise<void> {
  for (const t of TENANTS) {
    await asTenant(t, async (sql) => {
      await sql`DELETE FROM health.mobile_screen_renders WHERE tenant_id = ${t}`;
      await sql`DELETE FROM health.mobile_telemetry_events WHERE tenant_id = ${t}`;
    });
  }
}

let app: FastifyInstance;
beforeAll(async () => {
  // POST /v1/admin/mobile-telemetry was converted to F3 async (202 accepted):
  // the route validates synchronously (zod + the semantic checks below) and
  // then publishes admin.mobile_telemetry.record; the actual event/screen-render
  // insert only happens in registerMobileTelemetryConsumers, which is normally
  // wired only in src/worker.ts (a process this test never runs). Register it
  // here against the real in-memory test Queue singleton buildApp() wires the
  // routes through, tenantScoped like worker.ts does — the consumer itself
  // does not call runWithTenant, so FORCE RLS tables need the tenant GUC set
  // by the wrapper (see tests/helpers/register-all-f3-consumers.ts and
  // tests/central-config.test.ts for the same pattern).
  registerMobileTelemetryConsumers(tenantScoped(queue));
  await queue.start();
  app = await buildApp();
  await wipe();
});
afterAll(async () => { await wipe(); await app.close(); await queue.stop(); await sqlClient.end(); });

interface SingleBody<T> { data: T }
interface ListBody<T> { data: T[]; meta: { page: number; pageSize: number; total: number } }
interface ErrBody { error: { code: string; message: string; correlationId: string; details?: Record<string, string> } }

interface Bucket {
  platform: string; appVersion: string; eventCount: number; sessionCount: number;
  coldStartP50Ms: number; coldStartP95Ms: number; coldStartMaxMs: number;
  crashCount: number; anrCount: number;
  crashesPerThousandSessions: number; anrsPerThousandSessions: number;
}
interface ScreenBucket { screen: string; observations: number; sampleCount: number; renderP50Ms: number; renderP95Ms: number; renderMaxMs: number }
interface Event { id: string; appVersion: string; platform: string; coldStartMs: number; recordedAt: string | null; warmStartMs: number | null }
/**
 * What the now-async ingest route actually echoes synchronously in its 202
 * body's `data` (see mobile-routes.ts: `data: { id, recordedAt }`) — NOT the
 * full row. The row itself (appVersion/platform/coldStartMs/etc.) only exists
 * once the consumer applies the write, and every test that needs those reads
 * them back via a GET below rather than off the ingest response.
 */
interface IngestedEvent { id: string; recordedAt: string }

const AT = (offsetMs = 0): string => new Date(Date.now() + offsetMs).toISOString();

function batch(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    appVersion: "1.0.0",
    platform: "android",
    osVersion: "14",
    deviceModel: "Pixel 8",
    coldStartMs: 900,
    crashCount: 0,
    anrCount: 0,
    sessionCount: 10,
    recordedAt: AT(-60_000),
    screens: [],
    ...over,
  };
}

async function ingest(over: Record<string, unknown> = {}, roles = ["employee"], tenantId = T_MAIN): Promise<IngestedEvent> {
  const res = await app.inject({
    method: "POST", url: "/v1/admin/mobile-telemetry", headers: auth(roles, tenantId), payload: batch(over),
  });
  expect(res.statusCode).toBe(202);
  // Land the write before the caller reads it back (directly via DB, or via
  // a follow-up GET) — mobile-consumer.ts DOES forward the route-generated id
  // (`repo.insertTelemetry(w, { id: p.id, ... })`), so unlike the sandbox and
  // central-config modules there is no id-mismatch bug here: the id echoed
  // below is the real persisted id once this drain completes.
  await (queue as any).drain?.();
  return (res.json() as SingleBody<IngestedEvent>).data;
}

async function expectIngestStatus(over: Record<string, unknown>, status: number, code?: string): Promise<void> {
  const res = await app.inject({
    method: "POST", url: "/v1/admin/mobile-telemetry", headers: auth(["employee"]), payload: batch(over),
  });
  expect(res.statusCode).toBe(status);
  if (code !== undefined) expect((res.json() as ErrBody).error.code).toBe(code);
}

// ── auth ────────────────────────────────────────────────────────────────────

describe("mobile telemetry — authentication and authorisation", () => {
  it("401 on ingest without a token", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/admin/mobile-telemetry", payload: batch() });
    expect(res.statusCode).toBe(401);
  });

  it("401 on each read view without a token", async () => {
    for (const url of [
      "/v1/admin/mobile-telemetry?limit=10",
      "/v1/admin/mobile-telemetry/aggregate?limit=10",
      "/v1/admin/mobile-telemetry/screens?limit=10",
    ]) {
      const res = await app.inject({ method: "GET", url });
      expect(res.statusCode).toBe(401);
    }
  });

  it("403 on ingest for a role outside the app-user set", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/admin/mobile-telemetry", headers: auth(["auditor_external"]), payload: batch(),
    });
    expect(res.statusCode).toBe(403);
  });

  it("ingest is open to ordinary app users — the mobile app is not an admin", async () => {
    for (const role of ["employee", "citizen", "officer", "manager"]) {
      const res = await app.inject({
        method: "POST", url: "/v1/admin/mobile-telemetry", headers: auth([role]), payload: batch(),
      });
      expect(res.statusCode).toBe(202);
    }
  });

  it("403 on the reporting views for a non-admin, even though ingest is allowed", async () => {
    for (const url of [
      "/v1/admin/mobile-telemetry?limit=10",
      "/v1/admin/mobile-telemetry/aggregate?limit=10",
      "/v1/admin/mobile-telemetry/screens?limit=10",
    ]) {
      const res = await app.inject({ method: "GET", url, headers: auth(["employee"]) });
      expect(res.statusCode).toBe(403);
      expect((res.json() as ErrBody).error.code).toBe("FORBIDDEN");
    }
  });
});

// ── ingest ──────────────────────────────────────────────────────────────────

describe("POST /v1/admin/mobile-telemetry — ingest", () => {
  it("stores one event and returns only its id and recordedAt", async () => {
    const created = await ingest({ appVersion: "9.9.9" });
    expect(created.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(created.recordedAt).not.toBeNull();
    const rows = await asTenant(T_MAIN, (sql) => sql<Array<{ n: number }>>`
      SELECT count(*)::int AS n FROM health.mobile_telemetry_events WHERE id = ${created.id}`);
    expect(rows[0]?.n).toBe(1);
  });

  it("stores the screen render rows attached to the event", async () => {
    const created = await ingest({
      appVersion: "3.0.0",
      screens: [
        { screen: "Home", renderMs: 120, sampleCount: 4 },
        { screen: "Payments", renderMs: 340, sampleCount: 2 },
      ],
    });
    const rows = await asTenant(T_MAIN, (sql) => sql<Array<{ screen: string; sample_count: number }>>`
      SELECT screen, sample_count FROM health.mobile_screen_renders
      WHERE event_id = ${created.id} ORDER BY screen`);
    expect(rows.map((r) => r.screen)).toEqual(["Home", "Payments"]);
    expect(rows[0]?.sample_count).toBe(4);
  });

  it("stores no screen rows when the batch has none", async () => {
    const created = await ingest();
    const rows = await asTenant(T_MAIN, (sql) => sql<Array<{ n: number }>>`
      SELECT count(*)::int AS n FROM health.mobile_screen_renders WHERE event_id = ${created.id}`);
    expect(rows[0]?.n).toBe(0);
  });

  it("keeps warmStartMs null when the client omits it", async () => {
    const created = await ingest();
    const rows = await asTenant(T_MAIN, (sql) => sql<Array<{ warm_start_ms: number | null }>>`
      SELECT warm_start_ms FROM health.mobile_telemetry_events WHERE id = ${created.id}`);
    expect(rows[0]?.warm_start_ms).toBeNull();
  });

  it("persists warmStartMs when supplied", async () => {
    const created = await ingest({ warmStartMs: 250 });
    const rows = await asTenant(T_MAIN, (sql) => sql<Array<{ warm_start_ms: number | null }>>`
      SELECT warm_start_ms FROM health.mobile_telemetry_events WHERE id = ${created.id}`);
    expect(rows[0]?.warm_start_ms).toBe(250);
  });

  it("stores recordedAt as the same instant when the client sends an IST offset (timestamptz)", async () => {
    // A device formatting in local time sends +05:30, not Z. Same instant.
    const instant = new Date(Date.now() - 60_000);
    const istWallClock = new Date(instant.getTime() + 5.5 * 60 * 60_000)
      .toISOString().replace("Z", "+05:30");
    const created = await ingest({ recordedAt: istWallClock });
    expect(created.recordedAt).toBe(instant.toISOString());
  });

  it("accepts the maximum allowed cold start", async () => {
    await ingest({ coldStartMs: 120_000 });
  });

  it("400 for a cold start above the ceiling — rejected, not clamped", async () => {
    await expectIngestStatus({ coldStartMs: 120_001 }, 400, "VALIDATION_FAILED");
    const rows = await asTenant(T_MAIN, (sql) => sql<Array<{ n: number }>>`
      SELECT count(*)::int AS n FROM health.mobile_telemetry_events
      WHERE tenant_id = ${T_MAIN} AND cold_start_ms > 120000`);
    expect(rows[0]?.n).toBe(0);
  });

  it("400 for a negative cold start", async () => {
    await expectIngestStatus({ coldStartMs: -1 }, 400);
  });

  it("400 for a non-integer cold start", async () => {
    await expectIngestStatus({ coldStartMs: 12.5 }, 400);
  });

  it("400 when coldStartMs is absent", async () => {
    const payload = batch();
    delete payload.coldStartMs;
    const res = await app.inject({
      method: "POST", url: "/v1/admin/mobile-telemetry", headers: auth(["employee"]), payload,
    });
    expect(res.statusCode).toBe(400);
    expect((res.json() as ErrBody).error.details).toHaveProperty("coldStartMs");
  });

  it("400 for a warm start above the ceiling", async () => {
    await expectIngestStatus({ warmStartMs: 120_001 }, 400);
  });

  it("400 for a render time above the ceiling", async () => {
    await expectIngestStatus({ screens: [{ screen: "Home", renderMs: 60_001, sampleCount: 1 }] }, 400);
  });

  it("400 for a crash count above the ceiling", async () => {
    await expectIngestStatus({ crashCount: 10_001, sessionCount: 100_000 }, 400);
  });

  it("400 for an ANR count above the ceiling", async () => {
    await expectIngestStatus({ anrCount: 10_001, sessionCount: 100_000 }, 400);
  });

  it("400 for a session count of zero", async () => {
    await expectIngestStatus({ sessionCount: 0 }, 400);
  });

  it("400 for a session count above the ceiling", async () => {
    await expectIngestStatus({ sessionCount: 100_001 }, 400);
  });

  it("400 for more screens than one batch may carry", async () => {
    const screens = Array.from({ length: 51 }, (_, i) => ({ screen: `S${i}`, renderMs: 1, sampleCount: 1 }));
    await expectIngestStatus({ screens }, 400);
  });

  it("accepts exactly the maximum number of screens", async () => {
    const screens = Array.from({ length: 50 }, (_, i) => ({ screen: `Max${i}`, renderMs: 1, sampleCount: 1 }));
    await ingest({ appVersion: "8.0.0", screens });
  });

  it("400 for an unknown platform", async () => {
    await expectIngestStatus({ platform: "windows-phone" }, 400);
  });

  it("400 for an app version with characters outside the allowed charset", async () => {
    await expectIngestStatus({ appVersion: "1.0.0 (beta build)" }, 400);
  });

  it("400 for a screen name with characters outside the allowed charset", async () => {
    await expectIngestStatus({ screens: [{ screen: "Home<script>", renderMs: 1, sampleCount: 1 }] }, 400);
  });

  it("400 for a recordedAt that is not an ISO datetime", async () => {
    await expectIngestStatus({ recordedAt: "yesterday" }, 400);
  });

  it("422 RECORDED_AT_IN_FUTURE for a clock too far ahead", async () => {
    await expectIngestStatus({ recordedAt: AT(20 * 60_000) }, 422, "RECORDED_AT_IN_FUTURE");
  });

  it("422 RECORDED_AT_TOO_OLD beyond the retention window", async () => {
    await expectIngestStatus({ recordedAt: AT(-8 * 24 * 60 * 60_000) }, 422, "RECORDED_AT_TOO_OLD");
  });

  it("422 CRASH_EXCEEDS_SESSIONS for an impossible crash count", async () => {
    await expectIngestStatus({ crashCount: 11, sessionCount: 10 }, 422, "CRASH_EXCEEDS_SESSIONS");
  });

  it("422 ANR_EXCEEDS_SESSIONS for an impossible ANR count", async () => {
    await expectIngestStatus({ anrCount: 11, sessionCount: 10 }, 422, "ANR_EXCEEDS_SESSIONS");
  });

  it("422 DUPLICATE_SCREEN when one batch reports a screen twice", async () => {
    await expectIngestStatus({
      screens: [
        { screen: "Home", renderMs: 1, sampleCount: 1 },
        { screen: "home", renderMs: 2, sampleCount: 1 },
      ],
    }, 422, "DUPLICATE_SCREEN");
  });

  it("stores nothing when a semantic check rejects the batch", async () => {
    const before = await asTenant(T_MAIN, (sql) => sql<Array<{ n: number }>>`
      SELECT count(*)::int AS n FROM health.mobile_telemetry_events WHERE tenant_id = ${T_MAIN}`);
    await expectIngestStatus({ appVersion: "7.7.7", crashCount: 50, sessionCount: 1 }, 422);
    const after = await asTenant(T_MAIN, (sql) => sql<Array<{ n: number }>>`
      SELECT count(*)::int AS n FROM health.mobile_telemetry_events WHERE tenant_id = ${T_MAIN}`);
    expect(after[0]?.n).toBe(before[0]?.n);
  });
});

// ── raw list ────────────────────────────────────────────────────────────────

describe("GET /v1/admin/mobile-telemetry — raw events", () => {
  it("returns the list envelope, newest recordedAt first", async () => {
    await ingest({ appVersion: "5.0.0", recordedAt: AT(-3 * 60_000), coldStartMs: 100 });
    await ingest({ appVersion: "5.0.0", recordedAt: AT(-1 * 60_000), coldStartMs: 200 });
    const res = await app.inject({
      method: "GET", url: "/v1/admin/mobile-telemetry?limit=50&appVersion=5.0.0", headers: auth(),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as ListBody<Event>;
    expect(body.meta.total).toBe(2);
    expect(body.data[0]?.coldStartMs).toBe(200);
  });

  it("filters by platform", async () => {
    await ingest({ appVersion: "6.0.0", platform: "ios" });
    await ingest({ appVersion: "6.0.0", platform: "android" });
    const res = await app.inject({
      method: "GET", url: "/v1/admin/mobile-telemetry?limit=50&appVersion=6.0.0&platform=ios", headers: auth(),
    });
    const body = res.json() as ListBody<Event>;
    expect(body.data.every((r) => r.platform === "ios")).toBe(true);
    expect(body.meta.total).toBe(1);
  });

  it("filters by a from/to recordedAt window", async () => {
    const anchor = Date.now() - 45 * 60_000;
    await ingest({ appVersion: "6.5.0", recordedAt: new Date(anchor).toISOString() });
    const res = await app.inject({
      method: "GET",
      url: `/v1/admin/mobile-telemetry?limit=50&appVersion=6.5.0&from=${encodeURIComponent(new Date(anchor - 60_000).toISOString())}&to=${encodeURIComponent(new Date(anchor + 60_000).toISOString())}`,
      headers: auth(),
    });
    expect((res.json() as ListBody<Event>).meta.total).toBe(1);
  });

  it("returns nothing for a window that excludes the event", async () => {
    await ingest({ appVersion: "6.6.0", recordedAt: AT(-60_000) });
    const res = await app.inject({
      method: "GET",
      url: `/v1/admin/mobile-telemetry?limit=50&appVersion=6.6.0&to=${encodeURIComponent(AT(-6 * 24 * 60 * 60_000))}`,
      headers: auth(),
    });
    expect((res.json() as ListBody<Event>).meta.total).toBe(0);
  });

  it("paginates", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/admin/mobile-telemetry?limit=1&page=2&appVersion=5.0.0", headers: auth(),
    });
    const body = res.json() as ListBody<Event>;
    expect(body.data).toHaveLength(1);
    expect(body.meta.page).toBe(2);
  });

  it("400 without limit and 400 above the limit ceiling", async () => {
    const none = await app.inject({ method: "GET", url: "/v1/admin/mobile-telemetry", headers: auth() });
    expect(none.statusCode).toBe(400);
    const over = await app.inject({ method: "GET", url: "/v1/admin/mobile-telemetry?limit=500", headers: auth() });
    expect(over.statusCode).toBe(400);
  });

  it("400 for an invalid from timestamp", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/admin/mobile-telemetry?limit=10&from=nope", headers: auth() });
    expect(res.statusCode).toBe(400);
  });

  it("400 for an unknown platform filter", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/admin/mobile-telemetry?limit=10&platform=symbian", headers: auth(),
    });
    expect(res.statusCode).toBe(400);
  });
});

// ── aggregate ───────────────────────────────────────────────────────────────

describe("GET /v1/admin/mobile-telemetry/aggregate", () => {
  const V = "2.5.0";

  beforeAll(async () => {
    await ingest({ appVersion: V, platform: "android", coldStartMs: 100, crashCount: 1, anrCount: 0, sessionCount: 500 });
    await ingest({ appVersion: V, platform: "android", coldStartMs: 300, crashCount: 1, anrCount: 1, sessionCount: 500 });
    await ingest({ appVersion: V, platform: "ios", coldStartMs: 800, crashCount: 0, anrCount: 0, sessionCount: 100 });
  });

  it("buckets by platform + app version with percentiles and rates", async () => {
    const res = await app.inject({
      method: "GET", url: `/v1/admin/mobile-telemetry/aggregate?limit=200&appVersion=${V}`, headers: auth(),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as ListBody<Bucket>;
    expect(body.meta.total).toBe(2);
    const android = body.data.find((b) => b.platform === "android");
    expect(android).toMatchObject({
      eventCount: 2, sessionCount: 1000, crashCount: 2, anrCount: 1,
      // Nearest rank over [100, 300]: ceil(0.5 * 2) = 1 → the lower sample.
      coldStartP50Ms: 100, coldStartP95Ms: 300, coldStartMaxMs: 300,
      crashesPerThousandSessions: 2, anrsPerThousandSessions: 1,
    });
    const ios = body.data.find((b) => b.platform === "ios");
    expect(ios?.crashesPerThousandSessions).toBe(0);
  });

  it("narrows to one bucket when filtered by platform", async () => {
    const res = await app.inject({
      method: "GET", url: `/v1/admin/mobile-telemetry/aggregate?limit=200&appVersion=${V}&platform=ios`, headers: auth(),
    });
    const body = res.json() as ListBody<Bucket>;
    expect(body.data).toHaveLength(1);
    expect(body.data[0]?.platform).toBe("ios");
  });

  it("returns an empty bucket list for a version with no data", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/admin/mobile-telemetry/aggregate?limit=200&appVersion=0.0.0-none", headers: auth(),
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as ListBody<Bucket>).meta.total).toBe(0);
  });

  it("422 INVALID_RANGE when from is after to", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/admin/mobile-telemetry/aggregate?limit=10&from=${encodeURIComponent(AT(0))}&to=${encodeURIComponent(AT(-60_000))}`,
      headers: auth(),
    });
    expect(res.statusCode).toBe(422);
    expect((res.json() as ErrBody).error.code).toBe("INVALID_RANGE");
  });

  it("accepts from == to", async () => {
    const t = AT(-60_000);
    const res = await app.inject({
      method: "GET",
      url: `/v1/admin/mobile-telemetry/aggregate?limit=10&from=${encodeURIComponent(t)}&to=${encodeURIComponent(t)}`,
      headers: auth(),
    });
    expect(res.statusCode).toBe(200);
  });

  it("400 without limit", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/admin/mobile-telemetry/aggregate", headers: auth() });
    expect(res.statusCode).toBe(400);
  });

  it("does not aggregate another tenant's telemetry", async () => {
    await ingest({ appVersion: "1.2.3", coldStartMs: 111 }, ["employee"], T_ALT);
    const res = await app.inject({
      method: "GET", url: "/v1/admin/mobile-telemetry/aggregate?limit=200&appVersion=1.2.3", headers: auth(),
    });
    expect((res.json() as ListBody<Bucket>).meta.total).toBe(0);

    const own = await app.inject({
      method: "GET", url: "/v1/admin/mobile-telemetry/aggregate?limit=200&appVersion=1.2.3",
      headers: auth(["tenant_admin"], T_ALT),
    });
    expect((own.json() as ListBody<Bucket>).meta.total).toBe(1);
  });
});

// ── screens ─────────────────────────────────────────────────────────────────

describe("GET /v1/admin/mobile-telemetry/screens", () => {
  const V = "4.4.4";

  beforeAll(async () => {
    await ingest({
      appVersion: V, platform: "ios",
      screens: [{ screen: "Dashboard", renderMs: 120, sampleCount: 3 }, { screen: "Bills", renderMs: 400, sampleCount: 1 }],
    });
    await ingest({
      appVersion: V, platform: "ios",
      screens: [{ screen: "Dashboard", renderMs: 620, sampleCount: 2 }],
    });
  });

  it("aggregates render timings per screen", async () => {
    const res = await app.inject({
      method: "GET", url: `/v1/admin/mobile-telemetry/screens?limit=200&appVersion=${V}`, headers: auth(),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as ListBody<ScreenBucket>;
    const dash = body.data.find((b) => b.screen === "Dashboard");
    // Nearest rank over [120, 620]: p50 takes the lower sample, p95 the upper.
    expect(dash).toMatchObject({ observations: 2, sampleCount: 5, renderP50Ms: 120, renderP95Ms: 620, renderMaxMs: 620 });
    expect(body.data.map((b) => b.screen)).toEqual(["Bills", "Dashboard"]);
  });

  it("filters to one screen", async () => {
    const res = await app.inject({
      method: "GET", url: `/v1/admin/mobile-telemetry/screens?limit=200&appVersion=${V}&screen=Bills`, headers: auth(),
    });
    const body = res.json() as ListBody<ScreenBucket>;
    expect(body.data).toHaveLength(1);
    expect(body.data[0]?.screen).toBe("Bills");
  });

  it("returns an empty list for a screen nobody reported", async () => {
    const res = await app.inject({
      method: "GET", url: `/v1/admin/mobile-telemetry/screens?limit=200&appVersion=${V}&screen=Ghost`, headers: auth(),
    });
    expect((res.json() as ListBody<ScreenBucket>).meta.total).toBe(0);
  });

  it("filters screens by platform", async () => {
    const res = await app.inject({
      method: "GET", url: `/v1/admin/mobile-telemetry/screens?limit=200&appVersion=${V}&platform=android`, headers: auth(),
    });
    expect((res.json() as ListBody<ScreenBucket>).meta.total).toBe(0);
  });

  it("400 without limit", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/admin/mobile-telemetry/screens", headers: auth() });
    expect(res.statusCode).toBe(400);
  });
});
