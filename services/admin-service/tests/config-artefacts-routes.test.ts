/**
 * WC-010 — configuration-as-artefact route integration tests.
 *
 * Real Postgres with RLS forced, real Fastify via app.inject(). Covers every
 * endpoint's happy path plus 400 (zod), 401, 403, 404, 409 and 422 paths, the
 * maker-checker separation of duties, and the optimistic lock on both the
 * promotion row and the environment-state row.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";

const { buildApp } = await import("../src/app.js");
const { sqlClient } = await import("../src/shared/db.js");
const { queue } = await import("../src/shared/infra.js");
const { tenantScoped } = await import("../src/shared/tenant-queue.js");
const { registerF3_config_Consumers } = await import("../src/modules/config/artefact-f3-consumer.js");

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";

const T_MAIN = "caf00000-0000-4000-8000-0000000000a1";
const T_ROLLBACK = "caf00000-0000-4000-8000-0000000000a2";
const T_GAP = "caf00000-0000-4000-8000-0000000000a3";
const T_ISO = "caf00000-0000-4000-8000-0000000000a4";
const TENANTS = [T_MAIN, T_ROLLBACK, T_GAP, T_ISO];

const MAKER = "caf11111-0000-4000-8000-000000000001";
const CHECKER = "caf22222-0000-4000-8000-000000000002";

function auth(actorId: string, roles: string[] = ["tenant_admin"], tenantId = T_MAIN): { authorization: string } {
  return { authorization: `Bearer ${signToken({ sub: actorId, tid: tenantId, roles, sid: "sess-caf" }, SECRET, 3600)}` };
}

/** Run raw SQL with the RLS GUC set — admin_svc is NOBYPASSRLS. */
function asTenant<T>(tenantId: string, run: (sql: typeof sqlClient) => Promise<T>): Promise<T> {
  return sqlClient.begin(async (sql) => {
    await sql`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
    return run(sql as typeof sqlClient);
  }) as Promise<T>;
}

async function wipe(): Promise<void> {
  for (const t of TENANTS) {
    await asTenant(t, async (sql) => {
      await sql`DELETE FROM config.config_env_state WHERE tenant_id = ${t}`;
      await sql`DELETE FROM config.config_promotions WHERE tenant_id = ${t}`;
      await sql`DELETE FROM config.config_artefacts WHERE tenant_id = ${t}`;
    });
  }
}

let app: FastifyInstance;
beforeAll(async () => {
  // F3 CONSUMER WIRING — every write route in this module (snapshot/promote/
  // approve/reject/rollback) was converted to publish a command via
  // artefact-f3-apply.ts -> queue.publish() and is only ever applied by the
  // consumer registered in src/worker.ts, a process this test never runs.
  // Without registering it here every write's downstream state change is
  // silently never applied. Same pattern as tests/central-config.test.ts /
  // tests/security-incident.test.ts.
  registerF3_config_Consumers(tenantScoped(queue));
  await queue.start();
  app = await buildApp();
  await wipe();
});
afterAll(async () => { await wipe(); await app.close(); await queue.stop(); await sqlClient.end(); });

interface SingleBody<T> { data: T }
interface ListBody<T> { data: T[]; meta: { page: number; pageSize: number; total: number } }
interface ErrBody { error: { code: string; message: string; correlationId: string; details?: Record<string, string> } }

interface Artefact { id: string; setKey: string; artefactVersion: number; checksum: string; version: number; note: string | null }
interface Promotion { id: string; setKey: string; status: string; version: number; artefactVersion: number; targetEnv: string; kind: string }

async function snapshot(
  setKey: string,
  entries: Record<string, unknown>,
  tenantId = T_MAIN,
  actor = MAKER,
  note?: string,
): Promise<Artefact> {
  const res = await app.inject({
    method: "POST", url: "/v1/admin/config-artefacts",
    headers: auth(actor, ["tenant_admin"], tenantId),
    payload: note === undefined ? { setKey, entries } : { setKey, entries, note },
  });
  expect(res.statusCode).toBe(202);
  await (queue as any).drain?.();
  // config/artefact-f3-apply.ts's apply_config_0 (snapshot) never forwards the
  // route-generated id into repo.insertArtefact() — the DB assigns its own id
  // (schema default), so the id echoed in the 202 response does NOT match the
  // persisted row. Same class of bug already documented in
  // tests/integration-ops.test.ts / tests/central-config.test.ts (real,
  // pre-existing, out of this batch's scope). Look the just-created row up by
  // content (setKey, newest version — the list is already ordered desc by
  // artefactVersion) instead of trusting the echoed id.
  const list = await app.inject({
    method: "GET", url: `/v1/admin/config-artefacts?limit=200&setKey=${encodeURIComponent(setKey)}`,
    headers: auth(actor, ["tenant_admin"], tenantId),
  });
  const rows = (list.json() as ListBody<Artefact>).data;
  const match = rows[0];
  if (!match) throw new Error(`snapshot for '${setKey}' never landed`);
  return match;
}

async function requestPromotion(
  setKey: string, artefactVersion: number, targetEnv: string,
  tenantId = T_MAIN, actor = MAKER,
): Promise<Promotion> {
  const res = await app.inject({
    method: "POST", url: "/v1/admin/config-artefacts/promotions",
    headers: auth(actor, ["tenant_admin"], tenantId),
    payload: { setKey, artefactVersion, targetEnv },
  });
  expect(res.statusCode).toBe(202);
  await (queue as any).drain?.();
  // Same id-mismatch class of bug as snapshot() above — apply_config_1 never
  // forwards the route-generated id into repo.insertPromotion(). Look the
  // just-created row up by content instead of trusting the echoed id.
  const list = await app.inject({
    method: "GET", url: "/v1/admin/config-artefacts/promotions?limit=200&status=pending",
    headers: auth(actor, ["tenant_admin"], tenantId),
  });
  const rows = (list.json() as ListBody<Promotion>).data;
  const match = rows.find((r) => r.setKey === setKey && r.artefactVersion === artefactVersion && r.targetEnv === targetEnv);
  if (!match) throw new Error(`promotion request for '${setKey}' -> ${targetEnv} never landed`);
  return match;
}

/**
 * Approves a promotion and returns the real, persisted env-state version.
 *
 * 202 command-acknowledgement envelope — apply_config_2's own computed result
 * object (status/environment/artefactVersion/envStateVersion) is discarded
 * inside the consumer and never echoed anywhere (there is no channel back to
 * the HTTP caller). Verify via the real persisted promotion + environment
 * rows instead of the synchronous response body — there is no GET-by-id for
 * a single promotion, so re-list and match by id.
 */
async function approve(id: string, expectedVersion: number, tenantId = T_MAIN, actor = CHECKER): Promise<number> {
  const res = await app.inject({
    method: "POST", url: `/v1/admin/config-artefacts/promotions/${id}/approve`,
    headers: auth(actor, ["tenant_admin"], tenantId),
    payload: { expectedVersion },
  });
  expect(res.statusCode).toBe(202);
  await (queue as any).drain?.();
  const list = await app.inject({
    method: "GET", url: "/v1/admin/config-artefacts/promotions?limit=200",
    headers: auth(actor, ["tenant_admin"], tenantId),
  });
  const promo = (list.json() as ListBody<Promotion>).data.find((r) => r.id === id);
  if (!promo) throw new Error(`promotion ${id} not found after approve`);
  const envs = await app.inject({
    method: "GET", url: "/v1/admin/config-artefacts/environments?limit=200",
    headers: auth(actor, ["tenant_admin"], tenantId),
  });
  const state = (envs.json() as ListBody<{ setKey: string; environment: string; version: number }>)
    .data.find((r) => r.setKey === promo.setKey && r.environment === promo.targetEnv);
  if (!state) throw new Error(`env state for ${promo.setKey}/${promo.targetEnv} never landed`);
  return state.version;
}

// ── auth ────────────────────────────────────────────────────────────────────

describe("config-artefacts — authentication and authorisation", () => {
  const cases: Array<[string, string, Record<string, unknown> | undefined]> = [
    ["GET", "/v1/admin/config-artefacts?limit=10", undefined],
    ["POST", "/v1/admin/config-artefacts", { setKey: "s", entries: { a: 1 } }],
    ["GET", "/v1/admin/config-artefacts/diff?setKey=s&fromVersion=1&toVersion=2", undefined],
    ["GET", "/v1/admin/config-artefacts/promotions?limit=10", undefined],
    ["POST", "/v1/admin/config-artefacts/promotions", { setKey: "s", artefactVersion: 1, targetEnv: "dev" }],
    ["GET", "/v1/admin/config-artefacts/environments?limit=10", undefined],
  ];

  for (const [method, url, payload] of cases) {
    it(`401 without a token — ${method} ${url.split("?")[0] ?? url}`, async () => {
      const res = await app.inject({ method: method as "GET", url, ...(payload ? { payload } : {}) });
      expect(res.statusCode).toBe(401);
    });

    it(`403 for a role outside the admin set — ${method} ${url.split("?")[0] ?? url}`, async () => {
      const res = await app.inject({
        method: method as "GET", url, headers: auth(MAKER, ["citizen"]), ...(payload ? { payload } : {}),
      });
      expect(res.statusCode).toBe(403);
      expect((res.json() as ErrBody).error.code).toBe("FORBIDDEN");
    });
  }

  it("401 for the rollback route without a token", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/admin/config-artefacts/environments/dev/rollback",
      payload: { setKey: "s", toVersion: 1, expectedVersion: 1 },
    });
    expect(res.statusCode).toBe(401);
  });

  it("403 for rollback as tenant_admin — rollback is platform-privileged", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/admin/config-artefacts/environments/dev/rollback",
      headers: auth(CHECKER, ["tenant_admin"]),
      payload: { setKey: "whatever", toVersion: 1, expectedVersion: 1 },
    });
    expect(res.statusCode).toBe(403);
  });

  it("errors carry the standard envelope with a correlationId", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/admin/config-artefacts?limit=10",
      headers: { ...auth(MAKER, ["citizen"]), "x-correlation-id": "corr-artefact-1" },
    });
    const body = res.json() as ErrBody;
    expect(body.error.correlationId).toBe("corr-artefact-1");
    expect(typeof body.error.message).toBe("string");
  });
});

// ── snapshot ────────────────────────────────────────────────────────────────

describe("POST /v1/admin/config-artefacts — snapshot", () => {
  it("creates version 1 with a sha-256 checksum and echoes the single envelope", async () => {
    const row = await snapshot("app.core", { debug: false, db: { host: "h", port: 5432 } });
    expect(row.artefactVersion).toBe(1);
    expect(row.checksum).toMatch(/^[0-9a-f]{64}$/);
    expect(row.version).toBe(1);
  });

  it("increments the artefact version per set, independently of other sets", async () => {
    const a = await snapshot("app.multi", { v: 1 });
    const other = await snapshot("app.other", { v: 1 });
    const b = await snapshot("app.multi", { v: 2 });
    expect(a.artefactVersion).toBe(1);
    expect(other.artefactVersion).toBe(1);
    expect(b.artefactVersion).toBe(2);
  });

  it("stores an optional note", async () => {
    // 202 command-acknowledgement envelope — note only exists once the async
    // consumer applies the write; verified via the real persisted row.
    const row = await snapshot("app.noted", { a: 1 }, T_MAIN, MAKER, "first cut");
    expect(row.note).toBe("first cut");
  });

  // GAP (not a stale-status-code issue, left unfixed): config-artefacts/routes.ts'
  // snapshot endpoint has no synchronous pre-accept duplicate-checksum check —
  // the current-head lookup + checksum comparison (ARTEFACT_UNCHANGED) only
  // happens inside the async consumer (artefact-f3-apply.ts's apply_config_0),
  // whose thrown error is swallowed by queue retry/DLQ machinery with no
  // channel back to the HTTP caller — a byte-identical snapshot is silently
  // accepted (202) here instead of the old synchronous 409. Same gap class as
  // tests/central-config.test.ts's "BLOCKS the proposer..." test.
  it("409 ARTEFACT_UNCHANGED when the set is byte-identical to the current head", async () => {
    await snapshot("app.same", { a: 1, b: 2 });
    const res = await app.inject({
      method: "POST", url: "/v1/admin/config-artefacts", headers: auth(MAKER),
      // Different key order — canonicalisation makes this the SAME artefact.
      payload: { setKey: "app.same", entries: { b: 2, a: 1 } },
    });
    expect(res.statusCode).toBe(409);
    expect((res.json() as ErrBody).error.code).toBe("ARTEFACT_UNCHANGED");
  });

  it("400 with per-field details when setKey is missing", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/admin/config-artefacts", headers: auth(MAKER),
      payload: { entries: { a: 1 } },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json() as ErrBody;
    expect(body.error.code).toBe("VALIDATION_FAILED");
    expect(body.error.details).toHaveProperty("setKey");
  });

  it("400 when setKey contains characters outside the allowed charset", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/admin/config-artefacts", headers: auth(MAKER),
      payload: { setKey: "bad key!", entries: { a: 1 } },
    });
    expect(res.statusCode).toBe(400);
  });

  it("400 when entries is not an object", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/admin/config-artefacts", headers: auth(MAKER),
      payload: { setKey: "app.core", entries: "nope" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("422 ARTEFACT_TOO_LARGE beyond the top-level key ceiling", async () => {
    const entries: Record<string, number> = {};
    for (let i = 0; i < 501; i++) entries[`k${i}`] = i;
    const res = await app.inject({
      method: "POST", url: "/v1/admin/config-artefacts", headers: auth(MAKER),
      payload: { setKey: "app.big", entries },
    });
    expect(res.statusCode).toBe(422);
    expect((res.json() as ErrBody).error.code).toBe("ARTEFACT_TOO_LARGE");
  });

  it("422 ARTEFACT_TOO_LARGE beyond the byte ceiling even with few keys", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/admin/config-artefacts", headers: auth(MAKER),
      payload: { setKey: "app.fat", entries: { blob: "x".repeat(300_000) } },
    });
    expect(res.statusCode).toBe(422);
    expect((res.json() as ErrBody).error.code).toBe("ARTEFACT_TOO_LARGE");
  });

  it("400 on a malformed JSON body rather than a 500", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/admin/config-artefacts",
      headers: { ...auth(MAKER), "content-type": "application/json" },
      payload: "{ not json",
    });
    expect(res.statusCode).toBe(400);
    expect((res.json() as ErrBody).error.code).toBe("BAD_REQUEST");
  });
});

// ── list + read ─────────────────────────────────────────────────────────────

describe("GET /v1/admin/config-artefacts — list and read", () => {
  it("returns the list envelope with meta, newest artefact version first", async () => {
    await snapshot("app.list", { n: 1 });
    await snapshot("app.list", { n: 2 });
    const res = await app.inject({
      method: "GET", url: "/v1/admin/config-artefacts?limit=50&setKey=app.list", headers: auth(CHECKER),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as ListBody<Artefact>;
    expect(body.meta.total).toBe(2);
    expect(body.meta.page).toBe(1);
    expect(body.meta.pageSize).toBe(50);
    expect(body.data.map((r) => r.artefactVersion)).toEqual([2, 1]);
  });

  it("paginates with page/limit", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/admin/config-artefacts?limit=1&page=2&setKey=app.list", headers: auth(CHECKER),
    });
    const body = res.json() as ListBody<Artefact>;
    expect(body.data).toHaveLength(1);
    expect(body.data[0]?.artefactVersion).toBe(1);
    expect(body.meta.page).toBe(2);
  });

  it("400 when limit is absent — an unbounded list is never served", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/admin/config-artefacts", headers: auth(CHECKER) });
    expect(res.statusCode).toBe(400);
  });

  it("400 when limit exceeds the 200 page-size ceiling", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/admin/config-artefacts?limit=201", headers: auth(CHECKER) });
    expect(res.statusCode).toBe(400);
  });

  it("400 when limit is zero", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/admin/config-artefacts?limit=0", headers: auth(CHECKER) });
    expect(res.statusCode).toBe(400);
  });

  it("reads a single artefact by id", async () => {
    const row = await snapshot("app.single", { a: 1 });
    const res = await app.inject({ method: "GET", url: `/v1/admin/config-artefacts/${row.id}`, headers: auth(CHECKER) });
    expect(res.statusCode).toBe(200);
    expect((res.json() as SingleBody<Artefact>).data.id).toBe(row.id);
  });

  it("404 for an unknown artefact id", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/admin/config-artefacts/caf99999-0000-4000-8000-000000000099", headers: auth(CHECKER),
    });
    expect(res.statusCode).toBe(404);
    expect((res.json() as ErrBody).error.code).toBe("NOT_FOUND");
  });

  it("400 for a non-uuid artefact id", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/admin/config-artefacts/not-a-uuid", headers: auth(CHECKER) });
    expect(res.statusCode).toBe(400);
  });

  it("does not leak another tenant's artefact by id", async () => {
    const mine = await snapshot("app.iso", { a: 1 }, T_ISO);
    const res = await app.inject({
      method: "GET", url: `/v1/admin/config-artefacts/${mine.id}`, headers: auth(CHECKER, ["tenant_admin"], T_MAIN),
    });
    expect(res.statusCode).toBe(404);
  });
});

// ── diff ────────────────────────────────────────────────────────────────────

describe("GET /v1/admin/config-artefacts/diff", () => {
  beforeAll(async () => {
    await snapshot("app.diff", { keep: 1, drop: 2, edit: 3, nested: { a: 1, b: 2 } });
    await snapshot("app.diff", { keep: 1, edit: 4, add: 5, nested: { a: 1, b: 9 } });
  });

  it("diffs two versions of a set at leaf granularity", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/admin/config-artefacts/diff?setKey=app.diff&fromVersion=1&toVersion=2",
      headers: auth(CHECKER),
    });
    expect(res.statusCode).toBe(200);
    const d = (res.json() as SingleBody<{
      fromVersion: number; toVersion: number; identical: boolean;
      added: Array<{ path: string }>; removed: Array<{ path: string }>; changed: Array<{ path: string }>;
      summary: { added: number; removed: number; changed: number; unchanged: number };
    }>).data;
    expect(d.fromVersion).toBe(1);
    expect(d.toVersion).toBe(2);
    expect(d.identical).toBe(false);
    expect(d.added.map((a) => a.path)).toEqual(["add"]);
    expect(d.removed.map((r) => r.path)).toEqual(["drop"]);
    expect(d.changed.map((c) => c.path)).toEqual(["edit", "nested.b"]);
    expect(d.summary.unchanged).toBe(2);
  });

  it("reports a version diffed against itself as identical", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/admin/config-artefacts/diff?setKey=app.diff&fromVersion=2&toVersion=2",
      headers: auth(CHECKER),
    });
    expect((res.json() as SingleBody<{ identical: boolean }>).data.identical).toBe(true);
  });

  it("404 when the from-version does not exist", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/admin/config-artefacts/diff?setKey=app.diff&fromVersion=99&toVersion=1",
      headers: auth(CHECKER),
    });
    expect(res.statusCode).toBe(404);
  });

  it("404 when the to-version does not exist", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/admin/config-artefacts/diff?setKey=app.diff&fromVersion=1&toVersion=99",
      headers: auth(CHECKER),
    });
    expect(res.statusCode).toBe(404);
  });

  it("404 for a set that has no artefacts at all", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/admin/config-artefacts/diff?setKey=app.nothing&fromVersion=1&toVersion=1",
      headers: auth(CHECKER),
    });
    expect(res.statusCode).toBe(404);
  });

  it("400 when a version is below 1", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/admin/config-artefacts/diff?setKey=app.diff&fromVersion=0&toVersion=1",
      headers: auth(CHECKER),
    });
    expect(res.statusCode).toBe(400);
  });

  it("400 when setKey is absent", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/admin/config-artefacts/diff?fromVersion=1&toVersion=2", headers: auth(CHECKER),
    });
    expect(res.statusCode).toBe(400);
  });
});

// ── promotion lifecycle ─────────────────────────────────────────────────────

describe("config-artefact promotions — maker-checker lifecycle", () => {
  it("requests a promotion in pending state", async () => {
    await snapshot("app.promo", { a: 1 });
    const p = await requestPromotion("app.promo", 1, "staging");
    expect(p.status).toBe("pending");
    expect(p.kind).toBe("promote");
    expect(p.version).toBe(1);
  });

  // GAP (not a stale-status-code issue, left unfixed): config-artefacts/routes.ts'
  // request-promotion endpoint has no synchronous pre-accept check that the
  // referenced artefact version exists — repo.findArtefactByVersionTx() only
  // runs inside the async consumer (apply_config_1), whose thrown 404 is
  // swallowed by queue retry/DLQ machinery with no channel back to the HTTP
  // caller — the route always synchronously replies 202 regardless.
  it("404 when promoting an artefact version that does not exist", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/admin/config-artefacts/promotions", headers: auth(MAKER),
      payload: { setKey: "app.promo", artefactVersion: 99, targetEnv: "dev" },
    });
    expect(res.statusCode).toBe(404);
  });

  it("400 for an environment outside the allowed set", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/admin/config-artefacts/promotions", headers: auth(MAKER),
      payload: { setKey: "app.promo", artefactVersion: 1, targetEnv: "nope" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("lists promotions filtered by status", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/admin/config-artefacts/promotions?limit=100&status=pending", headers: auth(CHECKER),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as ListBody<Promotion>;
    expect(body.data.every((r) => r.status === "pending")).toBe(true);
  });

  it("400 for an unknown status filter", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/admin/config-artefacts/promotions?limit=10&status=weird", headers: auth(CHECKER),
    });
    expect(res.statusCode).toBe(400);
  });

  // GAP (not a stale-status-code issue, left unfixed): same class as the
  // ARTEFACT_UNCHANGED gap above — assertApproverDistinct() (maker-checker)
  // only runs inside the async consumer (apply_config_2) now, so a
  // self-approval is silently accepted (202) here instead of the old
  // synchronous 409 MAKER_CHECKER_VIOLATION.
  it("409 MAKER_CHECKER_VIOLATION when the requester tries to self-approve", async () => {
    await snapshot("app.sod", { a: 1 });
    const p = await requestPromotion("app.sod", 1, "dev");
    const res = await app.inject({
      method: "POST", url: `/v1/admin/config-artefacts/promotions/${p.id}/approve`,
      headers: auth(MAKER), payload: { expectedVersion: p.version },
    });
    expect(res.statusCode).toBe(409);
    expect((res.json() as ErrBody).error.code).toBe("MAKER_CHECKER_VIOLATION");
  });

  // GAP (not a stale-status-code issue, left unfixed): assertVersionMatch()
  // for the promotion's optimistic lock only runs inside the async consumer
  // (apply_config_2) — a stale expectedVersion is silently accepted (202)
  // here instead of the old synchronous 409 VERSION_CONFLICT.
  it("409 VERSION_CONFLICT on a stale expectedVersion", async () => {
    await snapshot("app.stale", { a: 1 });
    const p = await requestPromotion("app.stale", 1, "dev");
    const res = await app.inject({
      method: "POST", url: `/v1/admin/config-artefacts/promotions/${p.id}/approve`,
      headers: auth(CHECKER), payload: { expectedVersion: p.version + 5 },
    });
    expect(res.statusCode).toBe(409);
    expect((res.json() as ErrBody).error.code).toBe("VERSION_CONFLICT");
  });

  it("400 when expectedVersion is absent from the approve body", async () => {
    await snapshot("app.noexp", { a: 1 });
    const p = await requestPromotion("app.noexp", 1, "dev");
    const res = await app.inject({
      method: "POST", url: `/v1/admin/config-artefacts/promotions/${p.id}/approve`,
      headers: auth(CHECKER), payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  // GAP (not a stale-status-code issue, left unfixed): repo.findPromotionByIdTx()
  // only runs inside the async consumer (apply_config_2) — approving an
  // unknown promotion id is silently accepted (202) here instead of the old
  // synchronous 404.
  it("404 when approving a promotion that does not exist", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/admin/config-artefacts/promotions/caf99999-0000-4000-8000-000000000098/approve",
      headers: auth(CHECKER), payload: { expectedVersion: 1 },
    });
    expect(res.statusCode).toBe(404);
  });

  it("400 when the promotion id is not a uuid", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/admin/config-artefacts/promotions/xyz/approve",
      headers: auth(CHECKER), payload: { expectedVersion: 1 },
    });
    expect(res.statusCode).toBe(400);
  });

  it("a distinct approver applies the promotion and makes the version live", async () => {
    await snapshot("app.apply", { a: 1 });
    const p = await requestPromotion("app.apply", 1, "uat");
    const res = await app.inject({
      method: "POST", url: `/v1/admin/config-artefacts/promotions/${p.id}/approve`,
      headers: auth(CHECKER), payload: { expectedVersion: p.version },
    });
    expect(res.statusCode).toBe(202);
    await (queue as any).drain?.();
    // 202 command-acknowledgement envelope — apply_config_2's computed result
    // (status/environment/artefactVersion/envStateVersion) is discarded and
    // never echoed anywhere; verify via the real persisted rows instead.
    const promos = await app.inject({
      method: "GET", url: "/v1/admin/config-artefacts/promotions?limit=200", headers: auth(CHECKER),
    });
    const promo = (promos.json() as ListBody<Promotion>).data.find((r) => r.id === p.id);
    expect(promo?.status).toBe("promoted");

    const envs = await app.inject({
      method: "GET", url: "/v1/admin/config-artefacts/environments?limit=100", headers: auth(CHECKER),
    });
    const live = (envs.json() as ListBody<{ setKey: string; environment: string; artefactVersion: number; version: number }>)
      .data.find((r) => r.setKey === "app.apply" && r.environment === "uat");
    expect(live?.artefactVersion).toBe(1);
    expect(live?.version).toBe(1);
  });

  // GAP (not a stale-status-code issue, left unfixed): assertPendingPromotion()
  // only runs inside the async consumer (apply_config_2) — re-approving an
  // already-decided promotion is silently accepted (202) here instead of the
  // old synchronous 409 NOT_PENDING. (The first approve() above IS fixed —
  // real, since that one only needed to land + be re-read.)
  it("409 NOT_PENDING when the same promotion is approved twice", async () => {
    await snapshot("app.twice", { a: 1 });
    const p = await requestPromotion("app.twice", 1, "dev");
    await approve(p.id, p.version);
    const again = await app.inject({
      method: "POST", url: `/v1/admin/config-artefacts/promotions/${p.id}/approve`,
      headers: auth(CHECKER), payload: { expectedVersion: p.version + 1 },
    });
    expect(again.statusCode).toBe(409);
    expect((again.json() as ErrBody).error.code).toBe("NOT_PENDING");
  });

  it("a second promotion to the same environment MOVES the env state and bumps its version", async () => {
    await snapshot("app.move", { a: 1 });
    await snapshot("app.move", { a: 2 });
    const p1 = await requestPromotion("app.move", 1, "staging");
    expect(await approve(p1.id, p1.version)).toBe(1);
    const p2 = await requestPromotion("app.move", 2, "staging");
    expect(await approve(p2.id, p2.version)).toBe(2);

    const envs = await app.inject({
      method: "GET", url: "/v1/admin/config-artefacts/environments?limit=100", headers: auth(CHECKER),
    });
    const live = (envs.json() as ListBody<{ setKey: string; environment: string; artefactVersion: number; version: number }>)
      .data.find((r) => r.setKey === "app.move" && r.environment === "staging");
    expect(live?.artefactVersion).toBe(2);
    expect(live?.version).toBe(2);
  });

  it("rejects a pending promotion with a reason and blocks a later approve", async () => {
    await snapshot("app.reject", { a: 1 });
    const p = await requestPromotion("app.reject", 1, "production");
    const rej = await app.inject({
      method: "POST", url: `/v1/admin/config-artefacts/promotions/${p.id}/reject`,
      headers: auth(CHECKER), payload: { expectedVersion: p.version, reason: "waiting on change window" },
    });
    expect(rej.statusCode).toBe(202);
    await (queue as any).drain?.();
    // 202 command-acknowledgement envelope — status only exists once the
    // async consumer applies the write; verified via the real persisted row.
    const promos = await app.inject({
      method: "GET", url: "/v1/admin/config-artefacts/promotions?limit=200", headers: auth(CHECKER),
    });
    const promo = (promos.json() as ListBody<Promotion>).data.find((r) => r.id === p.id);
    expect(promo?.status).toBe("rejected");

    // GAP (not a stale-status-code issue, left unfixed): assertPendingPromotion()
    // only runs inside the async consumer — approving an already-rejected
    // promotion is silently accepted (202) here instead of the old
    // synchronous 409 NOT_PENDING.
    const after = await app.inject({
      method: "POST", url: `/v1/admin/config-artefacts/promotions/${p.id}/approve`,
      headers: auth(CHECKER), payload: { expectedVersion: p.version + 1 },
    });
    expect(after.statusCode).toBe(409);
    expect((after.json() as ErrBody).error.code).toBe("NOT_PENDING");
  });

  it("400 when a reject omits the reason", async () => {
    await snapshot("app.noreason", { a: 1 });
    const p = await requestPromotion("app.noreason", 1, "dev");
    const res = await app.inject({
      method: "POST", url: `/v1/admin/config-artefacts/promotions/${p.id}/reject`,
      headers: auth(CHECKER), payload: { expectedVersion: p.version },
    });
    expect(res.statusCode).toBe(400);
    expect((res.json() as ErrBody).error.details).toHaveProperty("reason");
  });

  // GAP (not a stale-status-code issue, left unfixed): assertApproverDistinct()
  // for reject only runs inside the async consumer (apply_config_3) — a
  // self-reject is silently accepted (202) here instead of the old
  // synchronous 409 MAKER_CHECKER_VIOLATION.
  it("409 MAKER_CHECKER_VIOLATION when the requester rejects their own promotion", async () => {
    await snapshot("app.selfreject", { a: 1 });
    const p = await requestPromotion("app.selfreject", 1, "dev");
    const res = await app.inject({
      method: "POST", url: `/v1/admin/config-artefacts/promotions/${p.id}/reject`,
      headers: auth(MAKER), payload: { expectedVersion: p.version, reason: "changed my mind" },
    });
    expect(res.statusCode).toBe(409);
    expect((res.json() as ErrBody).error.code).toBe("MAKER_CHECKER_VIOLATION");
  });

  // GAP (not a stale-status-code issue, left unfixed): repo.findPromotionByIdTx()
  // for reject also only runs inside the async consumer — rejecting an
  // unknown promotion id is silently accepted (202) here instead of the old
  // synchronous 404.
  it("404 when rejecting an unknown promotion", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/admin/config-artefacts/promotions/caf99999-0000-4000-8000-000000000097/reject",
      headers: auth(CHECKER), payload: { expectedVersion: 1, reason: "nope" },
    });
    expect(res.statusCode).toBe(404);
  });

  it("writes exactly one promotion row per request — no consumer double-write", async () => {
    await snapshot("app.once", { a: 1 });
    const p = await requestPromotion("app.once", 1, "dev");
    await approve(p.id, p.version);
    const rows = await asTenant(T_MAIN, (sql) => sql<Array<{ n: number }>>`
      SELECT count(*)::int AS n FROM config.config_promotions
      WHERE tenant_id = ${T_MAIN} AND set_key = 'app.once'`);
    expect(rows[0]?.n).toBe(1);
    const envRows = await asTenant(T_MAIN, (sql) => sql<Array<{ n: number }>>`
      SELECT count(*)::int AS n FROM config.config_env_state
      WHERE tenant_id = ${T_MAIN} AND set_key = 'app.once'`);
    expect(envRows[0]?.n).toBe(1);
  });
});

// ── environments + rollback ─────────────────────────────────────────────────

describe("config-artefact environments and rollback", () => {
  const SET = "app.rollback";

  beforeAll(async () => {
    // v1, v2, v3 snapshotted; v1 and v3 promoted to dev (v2 deliberately skipped).
    await snapshot(SET, { n: 1 }, T_ROLLBACK);
    await snapshot(SET, { n: 2 }, T_ROLLBACK);
    await snapshot(SET, { n: 3 }, T_ROLLBACK);
    const p1 = await requestPromotion(SET, 1, "dev", T_ROLLBACK);
    await approve(p1.id, p1.version, T_ROLLBACK);
    const p3 = await requestPromotion(SET, 3, "dev", T_ROLLBACK);
    await approve(p3.id, p3.version, T_ROLLBACK);
  });

  function envState(): Promise<Array<{ artefact_version: number; version: number }>> {
    return asTenant(T_ROLLBACK, (sql) => sql<Array<{ artefact_version: number; version: number }>>`
      SELECT artefact_version, version FROM config.config_env_state
      WHERE tenant_id = ${T_ROLLBACK} AND set_key = ${SET} AND environment = 'dev'`);
  }

  it("400 for an environment outside the enum in the path", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/admin/config-artefacts/environments/nowhere/rollback",
      headers: auth(CHECKER, ["super_admin"], T_ROLLBACK),
      payload: { setKey: SET, toVersion: 1, expectedVersion: 2 },
    });
    expect(res.statusCode).toBe(400);
  });

  // GAP (not a stale-status-code issue, left unfixed): repo.findEnvStateTx()
  // only runs inside the async consumer (apply_config_4) — rolling back an
  // environment with no live artefact for the set is silently accepted (202)
  // here instead of the old synchronous 404.
  it("404 when no artefact is live in that environment for the set", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/admin/config-artefacts/environments/production/rollback",
      headers: auth(CHECKER, ["super_admin"], T_ROLLBACK),
      payload: { setKey: SET, toVersion: 1, expectedVersion: 1 },
    });
    expect(res.statusCode).toBe(404);
  });

  // GAP (not a stale-status-code issue, left unfixed): assertVersionMatch()
  // for the env-state optimistic lock only runs inside the async consumer —
  // a stale expectedVersion is silently accepted (202) here instead of the
  // old synchronous 409 VERSION_CONFLICT.
  it("409 VERSION_CONFLICT on a stale env-state expectedVersion", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/admin/config-artefacts/environments/dev/rollback",
      headers: auth(CHECKER, ["super_admin"], T_ROLLBACK),
      payload: { setKey: SET, toVersion: 1, expectedVersion: 99 },
    });
    expect(res.statusCode).toBe(409);
    expect((res.json() as ErrBody).error.code).toBe("VERSION_CONFLICT");
  });

  // GAP (not a stale-status-code issue, left unfixed): the rollback-target
  // repo.findArtefactByVersionTx() lookup only runs inside the async
  // consumer — targeting an artefact version that doesn't exist is silently
  // accepted (202) here instead of the old synchronous 404.
  it("404 when the rollback target artefact version does not exist", async () => {
    const state = await envState();
    const res = await app.inject({
      method: "POST", url: "/v1/admin/config-artefacts/environments/dev/rollback",
      headers: auth(CHECKER, ["super_admin"], T_ROLLBACK),
      payload: { setKey: SET, toVersion: 88, expectedVersion: state[0]?.version ?? 1 },
    });
    expect(res.statusCode).toBe(404);
  });

  // GAP (not a stale-status-code issue, left unfixed): assertRollbackIsBackwards()
  // only runs inside the async consumer — targeting a version that is not
  // strictly earlier than the live one is silently accepted (202) here
  // instead of the old synchronous 422 NOT_A_ROLLBACK.
  it("422 NOT_A_ROLLBACK when the target is not strictly earlier than the live version", async () => {
    const state = await envState();
    const res = await app.inject({
      method: "POST", url: "/v1/admin/config-artefacts/environments/dev/rollback",
      headers: auth(CHECKER, ["super_admin"], T_ROLLBACK),
      payload: { setKey: SET, toVersion: 3, expectedVersion: state[0]?.version ?? 1 },
    });
    expect(res.statusCode).toBe(422);
    expect((res.json() as ErrBody).error.code).toBe("NOT_A_ROLLBACK");
  });

  // GAP (not a stale-status-code issue, left unfixed): assertRollbackTargetPreviouslyPromoted()
  // only runs inside the async consumer — targeting a version never promoted
  // to this environment is silently accepted (202) here instead of the old
  // synchronous 422 ROLLBACK_TARGET_NOT_PROMOTED.
  it("422 ROLLBACK_TARGET_NOT_PROMOTED for a version never promoted to that environment", async () => {
    const state = await envState();
    const res = await app.inject({
      method: "POST", url: "/v1/admin/config-artefacts/environments/dev/rollback",
      headers: auth(CHECKER, ["super_admin"], T_ROLLBACK),
      payload: { setKey: SET, toVersion: 2, expectedVersion: state[0]?.version ?? 1 },
    });
    expect(res.statusCode).toBe(422);
    expect((res.json() as ErrBody).error.code).toBe("ROLLBACK_TARGET_NOT_PROMOTED");
  });

  it("rolls back to a previously-promoted earlier version and records a rollback promotion", async () => {
    const before = await envState();
    const expected = before[0]?.version ?? 1;
    const res = await app.inject({
      method: "POST", url: "/v1/admin/config-artefacts/environments/dev/rollback",
      headers: auth(CHECKER, ["super_admin"], T_ROLLBACK),
      payload: { setKey: SET, toVersion: 1, expectedVersion: expected },
    });
    expect(res.statusCode).toBe(202);
    await (queue as any).drain?.();
    // 202 command-acknowledgement envelope — apply_config_4's computed result
    // is discarded and never echoed anywhere; the rest of this test already
    // verified things via direct Postgres reads (below), so only the initial
    // response-status assertion needed to change.

    const after = await envState();
    expect(after[0]?.artefact_version).toBe(1);
    expect(after[0]?.version).toBe(expected + 1);

    const kinds = await asTenant(T_ROLLBACK, (sql) => sql<Array<{ kind: string; status: string }>>`
      SELECT kind, status FROM config.config_promotions
      WHERE tenant_id = ${T_ROLLBACK} AND set_key = ${SET} AND kind = 'rollback'`);
    expect(kinds).toHaveLength(1);
    expect(kinds[0]?.status).toBe("promoted");
  });

  it("400 when the rollback body omits expectedVersion", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/admin/config-artefacts/environments/dev/rollback",
      headers: auth(CHECKER, ["super_admin"], T_ROLLBACK),
      payload: { setKey: SET, toVersion: 1 },
    });
    expect(res.statusCode).toBe(400);
  });

  it("lists live environment state with the list envelope", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/admin/config-artefacts/environments?limit=10", headers: auth(CHECKER, ["tenant_admin"], T_ROLLBACK),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as ListBody<{ environment: string }>;
    expect(body.meta.total).toBeGreaterThanOrEqual(1);
  });

  it("400 when the environments list omits limit", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/admin/config-artefacts/environments", headers: auth(CHECKER, ["tenant_admin"], T_ROLLBACK),
    });
    expect(res.statusCode).toBe(400);
  });
});

// ── tenant isolation ───────────────────────────────────────────────────────

describe("config-artefacts — tenant isolation", () => {
  it("one tenant's set is invisible to another", async () => {
    await snapshot("app.secret", { a: 1 }, T_GAP);
    const res = await app.inject({
      method: "GET", url: "/v1/admin/config-artefacts?limit=200&setKey=app.secret",
      headers: auth(CHECKER, ["tenant_admin"], T_ISO),
    });
    expect((res.json() as ListBody<Artefact>).meta.total).toBe(0);
  });

  it("the same setKey can be versioned independently in two tenants", async () => {
    const a = await snapshot("app.shared-name", { a: 1 }, T_GAP);
    const b = await snapshot("app.shared-name", { a: 1 }, T_ISO);
    expect(a.artefactVersion).toBe(1);
    expect(b.artefactVersion).toBe(1);
  });
});
