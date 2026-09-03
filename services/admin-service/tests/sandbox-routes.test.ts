/**
 * WC-009 — sandbox environment + masked-refresh route integration tests.
 *
 * Real Postgres with RLS forced, real Fastify via app.inject(). Every endpoint
 * gets happy path + 400 + 401 + 403, plus the 404/409/422 paths the routes can
 * actually produce, the maker-checker split on refresh approval, and the
 * optimistic lock on the refresh job.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";

const { buildApp } = await import("../src/app.js");
const { sqlClient } = await import("../src/shared/db.js");
const { queue } = await import("../src/shared/infra.js");
const { tenantScoped } = await import("../src/shared/tenant-queue.js");
const { registerSandboxConsumers } = await import("../src/modules/sandbox/consumer.js");
const { registerF3_sandbox_Consumers } = await import("../src/modules/sandbox/f3-consumer.js");

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";

const T_MAIN = "5b000000-0000-4000-8000-0000000000b1";
const T_ALT = "5b000000-0000-4000-8000-0000000000b2";
const TENANTS = [T_MAIN, T_ALT];

const MAKER = "5b111111-0000-4000-8000-000000000001";
const CHECKER = "5b222222-0000-4000-8000-000000000002";
const MISSING_ID = "5b999999-0000-4000-8000-000000000099";

function auth(actorId: string, roles: string[] = ["tenant_admin"], tenantId = T_MAIN): { authorization: string } {
  return { authorization: `Bearer ${signToken({ sub: actorId, tid: tenantId, roles, sid: "sess-sbx" }, SECRET, 3600)}` };
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
      await sql`DELETE FROM sandbox.refresh_masked_fields WHERE tenant_id = ${t}`;
      await sql`DELETE FROM sandbox.refresh_jobs WHERE tenant_id = ${t}`;
      await sql`DELETE FROM sandbox.masking_rules WHERE tenant_id = ${t}`;
      await sql`DELETE FROM sandbox.sandbox_environments WHERE tenant_id = ${t}`;
    });
  }
}

let app: FastifyInstance;
beforeAll(async () => {
  // F3 CONSUMER WIRING — this test's app is built from src/app.ts alone, but
  // every sandbox write (register / masking-rule / refresh request / approve
  // / reject) was converted to async F3 (publishAdminCommand -> queue.publish,
  // 202 accepted) and is only ever applied by the consumer registered in
  // src/worker.ts, a process this test never runs. Without registering it
  // here, every write returns 202 and is NEVER applied.
  //
  // Deliberately NOT using the tests/helpers/register-all-f3-consumers.ts
  // "registerAllF3Consumers(queue)" wholesale helper here, unlike
  // tests/security-incident.test.ts: the in-memory test queue
  // (MemoryQueue.deliver() in services/queue-service/src/bus.ts) dedupes
  // deliveries with a `seen` Set keyed ONLY by `topic:messageId`, not by
  // handler/subscriber. Every F3-converted module (change, sandbox,
  // central-config, config, dept-templates, integration-settings, uploads,
  // support) publishes through the SAME shared topic
  // (COMMANDS.f3RouteWrite = "admin.f3.route_write"), each filtering by its
  // own `op` internally. `deliver()` runs synchronously up to its first
  // `await` — including `this.seen.add(key)` — so for a fan-out topic like
  // this one, only the FIRST-registered subscriber's handler for that
  // message ever actually runs; every other subscriber's deliver() call for
  // the SAME message sees `seen.has(key)` already true and returns
  // immediately without even reaching its own handler. Confirmed by
  // instrumenting MemoryQueue directly: with registerAllF3Consumers (8
  // f3RouteWrite subscribers, sandbox registered 6th), publishing a sandbox
  // f3RouteWrite command shows all 9 deliver() calls resolving instantly
  // with nothing in `dlq` and the sandbox handler's body never entered —
  // i.e. every sandbox write silently never lands. Registering ONLY
  // sandbox's own consumers here makes sandbox's f3RouteWrite handler the
  // sole subscriber to that topic in this file's queue instance, avoiding
  // the collision. Both calls mirror what registerAllF3Consumers does for
  // sandbox specifically (see its doc comment): registerSandboxConsumers
  // bare (handleSandboxRefreshExecute wraps its own work in runWithTenant(),
  // so worker.ts registers it bare, not tenantScoped) and
  // registerF3_sandbox_Consumers tenantScoped (the newer F3-converted
  // register/masking-rule/approve/reject ops). This is a real, pre-existing
  // bug in the shared MemoryQueue test driver (services/queue-service),
  // out of scope for this admin-service test-file batch — flagged in the
  // final report, not fixed here.
  registerSandboxConsumers(queue);
  registerF3_sandbox_Consumers(tenantScoped(queue));
  await queue.start();
  app = await buildApp();
  await wipe();
});
afterAll(async () => { await wipe(); await app.close(); await queue.stop(); await sqlClient.end(); });

interface SingleBody<T> { data: T }
interface ListBody<T> { data: T[]; meta: { page: number; pageSize: number; total: number } }
interface ErrBody { error: { code: string; message: string; correlationId: string; details?: Record<string, string> } }

interface Sandbox { id: string; code: string; status: string; sourceEnvironment: string; version: number; notes: string }
interface Rule { id: string; tableName: string; fieldName: string; strategy: string; justification: string; version: number }
interface PlannedField { tableName: string; fieldName: string; strategy: string; ruleSource: string; masked: boolean }
interface Job {
  id: string; sandboxId: string; status: string; version: number; dataMovement: string;
  requestedFields: Array<{ tableName: string; fieldName: string }>;
  plan?: { fields: PlannedField[]; maskedFieldCount: number; preservedFieldCount: number; defaultedFields: Array<{ tableName: string; fieldName: string }> };
}

let seq = 0;
function nextCode(prefix: string): string {
  seq += 1;
  return `${prefix}-${seq}`;
}

// sandbox/f3-apply.ts's apply_sandbox_0/1/2 (register / masking-rule /
// refresh-request) never forward the route-generated id into
// repo.insertSandbox() / repo.upsertMaskingRule() / repo.insertRefreshJob()
// — the DB assigns its own id (schema default), so the id echoed in each
// 202 response does NOT match the persisted row. Same class of bug already
// documented in tests/integration-ops.test.ts and worked around the same
// way in tests/central-config.test.ts: land the write, then look the real
// row up by a unique, known-in-advance field instead of trusting the echo.

async function register(code: string, tenantId = T_MAIN, sourceEnvironment = "production"): Promise<Sandbox> {
  const res = await app.inject({
    method: "POST", url: "/v1/admin/sandboxes", headers: auth(MAKER, ["tenant_admin"], tenantId),
    payload: { code, name: `Sandbox ${code}`, sourceEnvironment },
  });
  expect(res.statusCode).toBe(202);
  expect((res.json() as { status: string }).status).toBe("accepted");
  await (queue as any).drain?.();

  const list = await app.inject({
    method: "GET", url: "/v1/admin/sandboxes?limit=200", headers: auth(MAKER, ["tenant_admin"], tenantId),
  });
  const match = (list.json() as ListBody<Sandbox>).data.find((r) => r.code === code);
  if (!match) throw new Error(`registered sandbox '${code}' never landed`);
  return match;
}

async function setRule(
  sandboxId: string, tableName: string, fieldName: string, strategy: string,
  justification = "", tenantId = T_MAIN,
): Promise<Rule> {
  const res = await app.inject({
    method: "POST", url: `/v1/admin/sandboxes/${sandboxId}/masking-rules`,
    headers: auth(MAKER, ["tenant_admin"], tenantId),
    payload: { tableName, fieldName, strategy, justification },
  });
  expect(res.statusCode).toBe(202);
  expect((res.json() as { status: string }).status).toBe("accepted");
  await (queue as any).drain?.();

  const list = await app.inject({
    method: "GET", url: `/v1/admin/sandboxes/${sandboxId}/masking-rules?limit=200`,
    headers: auth(MAKER, ["tenant_admin"], tenantId),
  });
  const match = (list.json() as ListBody<Rule>).data.find((r) => r.tableName === tableName && r.fieldName === fieldName);
  if (!match) throw new Error(`masking rule ${tableName}.${fieldName} on sandbox ${sandboxId} never landed`);
  return match;
}

async function requestRefresh(
  sandboxId: string, fields: Array<{ tableName: string; fieldName: string }>, tenantId = T_MAIN, actor = MAKER,
): Promise<Job> {
  const res = await app.inject({
    method: "POST", url: `/v1/admin/sandboxes/${sandboxId}/refreshes`,
    headers: auth(actor, ["tenant_admin"], tenantId),
    payload: { requestedFields: fields },
  });
  expect(res.statusCode).toBe(202);
  expect((res.json() as { status: string }).status).toBe("accepted");
  await (queue as any).drain?.();

  // Jobs have no natural unique business key, unlike sandbox `code` or a
  // masking rule's (tableName, fieldName). Every test that calls this
  // creates at most one pending job per sandbox, so the newest
  // pending_approval job for this sandboxId is unambiguously the one just
  // created — list is ordered by createdAt desc (repo.listRefreshJobs).
  const list = await app.inject({
    method: "GET",
    url: `/v1/admin/sandbox-refreshes?limit=1&status=pending_approval&sandboxId=${sandboxId}`,
    headers: auth(actor, ["tenant_admin"], tenantId),
  });
  const match = (list.json() as ListBody<Job>).data[0];
  if (!match) throw new Error(`refresh request for sandbox ${sandboxId} never landed`);
  return match;
}

// ── auth ────────────────────────────────────────────────────────────────────

describe("sandbox routes — authentication and authorisation", () => {
  const cases: Array<[string, string, Record<string, unknown> | undefined]> = [
    ["GET", "/v1/admin/sandboxes?limit=10", undefined],
    ["POST", "/v1/admin/sandboxes", { code: "x", name: "X", sourceEnvironment: "dev" }],
    ["GET", `/v1/admin/sandboxes/${MISSING_ID}`, undefined],
    ["GET", `/v1/admin/sandboxes/${MISSING_ID}/masking-rules?limit=10`, undefined],
    ["POST", `/v1/admin/sandboxes/${MISSING_ID}/masking-rules`, { tableName: "t", fieldName: "f", strategy: "redact" }],
    ["POST", `/v1/admin/sandboxes/${MISSING_ID}/refreshes`, { requestedFields: [{ tableName: "t", fieldName: "f" }] }],
    ["GET", "/v1/admin/sandbox-refreshes?limit=10", undefined],
    ["GET", `/v1/admin/sandbox-refreshes/${MISSING_ID}`, undefined],
    ["GET", `/v1/admin/sandbox-refreshes/${MISSING_ID}/masked-fields?limit=10`, undefined],
    ["POST", `/v1/admin/sandbox-refreshes/${MISSING_ID}/approve`, { expectedVersion: 1 }],
    ["POST", `/v1/admin/sandbox-refreshes/${MISSING_ID}/reject`, { expectedVersion: 1, reason: "no" }],
  ];

  for (const [method, url, payload] of cases) {
    const label = `${method} ${(url.split("?")[0] ?? url).replace(MISSING_ID, ":id")}`;
    it(`401 without a token — ${label}`, async () => {
      const res = await app.inject({ method: method as "GET", url, ...(payload ? { payload } : {}) });
      expect(res.statusCode).toBe(401);
    });
    it(`403 for a non-admin role — ${label}`, async () => {
      const res = await app.inject({
        method: method as "GET", url, headers: auth(MAKER, ["employee"]), ...(payload ? { payload } : {}),
      });
      expect(res.statusCode).toBe(403);
      expect((res.json() as ErrBody).error.code).toBe("FORBIDDEN");
    });
  }
});

// ── register + read ────────────────────────────────────────────────────────

describe("POST /v1/admin/sandboxes — register", () => {
  it("registers a sandbox in `registered` status with the single envelope", async () => {
    const s = await register(nextCode("uat"));
    expect(s.status).toBe("registered");
    expect(s.sourceEnvironment).toBe("production");
    expect(s.version).toBe(1);
    expect(s.notes).toBe("");
  });

  it("400 when the code breaks the identifier charset", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/admin/sandboxes", headers: auth(MAKER),
      payload: { code: "Bad Code", name: "X", sourceEnvironment: "dev" },
    });
    expect(res.statusCode).toBe(400);
    expect((res.json() as ErrBody).error.details).toHaveProperty("code");
  });

  it("400 for an unknown source environment", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/admin/sandboxes", headers: auth(MAKER),
      payload: { code: nextCode("env"), name: "X", sourceEnvironment: "mars" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("400 when name is empty", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/admin/sandboxes", headers: auth(MAKER),
      payload: { code: nextCode("noname"), name: "", sourceEnvironment: "dev" },
    });
    expect(res.statusCode).toBe(400);
  });

  // GAP (not a stale-status-code issue, left unfixed): sandbox/routes.ts's
  // register endpoint has no synchronous pre-accept duplicate-code check —
  // unlike masking-rules' assertPreserveJustified, which routes.ts still
  // calls synchronously before publish — so a duplicate code is accepted
  // (202) here and the SANDBOX_EXISTS conflict is only ever detected inside
  // the async consumer (sandbox/f3-apply.ts's apply_sandbox_0, via
  // repo.findSandboxByCodeTx), whose thrown error has no channel back to the
  // HTTP caller. The guard still protects data integrity (only one row with
  // this code ever lands), just not observably to the caller. Same class of
  // gap as tests/central-config.test.ts's maker-checker GAP.
  it("409 SANDBOX_EXISTS on a duplicate code instead of leaking a driver error", async () => {
    const code = nextCode("dup");
    await register(code);
    const res = await app.inject({
      method: "POST", url: "/v1/admin/sandboxes", headers: auth(MAKER),
      payload: { code, name: "Duplicate", sourceEnvironment: "dev" },
    });
    expect(res.statusCode).toBe(409);
    expect((res.json() as ErrBody).error.code).toBe("SANDBOX_EXISTS");
    expect(JSON.stringify(res.json())).not.toContain("uq_sandbox_env_code");
  });

  it("allows the same code in a different tenant", async () => {
    const code = nextCode("shared");
    await register(code, T_MAIN);
    const other = await register(code, T_ALT);
    expect(other.code).toBe(code);
  });

  it("lists sandboxes with the list envelope", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/admin/sandboxes?limit=100", headers: auth(CHECKER) });
    expect(res.statusCode).toBe(200);
    const body = res.json() as ListBody<Sandbox>;
    expect(body.meta.pageSize).toBe(100);
    expect(body.meta.total).toBeGreaterThan(0);
  });

  it("400 when the list omits limit", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/admin/sandboxes", headers: auth(CHECKER) });
    expect(res.statusCode).toBe(400);
  });

  it("reads one sandbox by id, 404 for an unknown id, 400 for a non-uuid", async () => {
    const s = await register(nextCode("read"));
    const ok = await app.inject({ method: "GET", url: `/v1/admin/sandboxes/${s.id}`, headers: auth(CHECKER) });
    expect(ok.statusCode).toBe(200);
    expect((ok.json() as SingleBody<Sandbox>).data.id).toBe(s.id);

    const missing = await app.inject({ method: "GET", url: `/v1/admin/sandboxes/${MISSING_ID}`, headers: auth(CHECKER) });
    expect(missing.statusCode).toBe(404);

    const bad = await app.inject({ method: "GET", url: "/v1/admin/sandboxes/nope", headers: auth(CHECKER) });
    expect(bad.statusCode).toBe(400);
  });

  it("does not expose another tenant's sandbox", async () => {
    const s = await register(nextCode("iso"), T_ALT);
    const res = await app.inject({
      method: "GET", url: `/v1/admin/sandboxes/${s.id}`, headers: auth(CHECKER, ["tenant_admin"], T_MAIN),
    });
    expect(res.statusCode).toBe(404);
  });
});

// ── masking rules ──────────────────────────────────────────────────────────

describe("sandbox masking rules", () => {
  it("stores a rule and returns it without any field VALUE", async () => {
    const s = await register(nextCode("rules"));
    const r = await setRule(s.id, "citizens", "email", "hash");
    expect(r.strategy).toBe("hash");
    expect(r.tableName).toBe("citizens");
    expect(r.version).toBe(1);
  });

  it("upserts on (table, field): a second POST updates in place and bumps version", async () => {
    const s = await register(nextCode("upsert"));
    const first = await setRule(s.id, "citizens", "phone", "redact");
    const second = await setRule(s.id, "citizens", "phone", "nullify");
    expect(second.id).toBe(first.id);
    expect(second.strategy).toBe("nullify");
    expect(second.version).toBe(2);

    const list = await app.inject({
      method: "GET", url: `/v1/admin/sandboxes/${s.id}/masking-rules?limit=50`, headers: auth(CHECKER),
    });
    expect((list.json() as ListBody<Rule>).meta.total).toBe(1);
  });

  it("422 PRESERVE_NEEDS_JUSTIFICATION for a preserve rule with no justification", async () => {
    const s = await register(nextCode("preserve"));
    const res = await app.inject({
      method: "POST", url: `/v1/admin/sandboxes/${s.id}/masking-rules`, headers: auth(MAKER),
      payload: { tableName: "citizens", fieldName: "district", strategy: "preserve" },
    });
    expect(res.statusCode).toBe(422);
    expect((res.json() as ErrBody).error.code).toBe("PRESERVE_NEEDS_JUSTIFICATION");
  });

  it("accepts a preserve rule with a written justification", async () => {
    const s = await register(nextCode("preserve-ok"));
    const r = await setRule(s.id, "citizens", "district", "preserve", "district is public reference data");
    expect(r.strategy).toBe("preserve");
  });

  it("400 for an unknown strategy", async () => {
    const s = await register(nextCode("badstrat"));
    const res = await app.inject({
      method: "POST", url: `/v1/admin/sandboxes/${s.id}/masking-rules`, headers: auth(MAKER),
      payload: { tableName: "t", fieldName: "f", strategy: "obfuscate" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("400 for a table name that is not a valid SQL identifier", async () => {
    const s = await register(nextCode("badname"));
    const res = await app.inject({
      method: "POST", url: `/v1/admin/sandboxes/${s.id}/masking-rules`, headers: auth(MAKER),
      payload: { tableName: "t; DROP TABLE x", fieldName: "f", strategy: "redact" },
    });
    expect(res.statusCode).toBe(400);
  });

  // GAP (not a stale-status-code issue, left unfixed): the masking-rules
  // POST route only calls assertPreserveJustified synchronously before
  // publish; the sandbox-existence check (repo.findSandboxTx) moved into the
  // async consumer (sandbox/f3-apply.ts's apply_sandbox_1) and its thrown
  // 404 has no channel back to the HTTP caller — an unknown sandbox id is
  // accepted (202) here. Same class of gap as the register-duplicate-code
  // GAP above.
  it("404 when adding a rule to an unknown sandbox", async () => {
    const res = await app.inject({
      method: "POST", url: `/v1/admin/sandboxes/${MISSING_ID}/masking-rules`, headers: auth(MAKER),
      payload: { tableName: "t", fieldName: "f", strategy: "redact" },
    });
    expect(res.statusCode).toBe(404);
  });

  it("404 when listing rules for an unknown sandbox", async () => {
    const res = await app.inject({
      method: "GET", url: `/v1/admin/sandboxes/${MISSING_ID}/masking-rules?limit=10`, headers: auth(CHECKER),
    });
    expect(res.statusCode).toBe(404);
  });

  it("400 when listing rules without limit", async () => {
    const s = await register(nextCode("nolimit"));
    const res = await app.inject({
      method: "GET", url: `/v1/admin/sandboxes/${s.id}/masking-rules`, headers: auth(CHECKER),
    });
    expect(res.statusCode).toBe(400);
  });
});

// ── refresh request ────────────────────────────────────────────────────────

describe("POST /v1/admin/sandboxes/:id/refreshes — request", () => {
  it("returns the fail-closed plan: an unruled field is redacted, not passed through", async () => {
    const s = await register(nextCode("plan"));
    await setRule(s.id, "citizens", "email", "hash");
    await setRule(s.id, "citizens", "district", "preserve", "public reference data");
    const job = await requestRefresh(s.id, [
      { tableName: "citizens", fieldName: "email" },
      { tableName: "citizens", fieldName: "district" },
      { tableName: "citizens", fieldName: "aadhaar" },
    ]);
    expect(job.status).toBe("pending_approval");
    expect(job.dataMovement).toBe("stubbed");
    // GAP (not a stale-status-code issue, left unfixed): the pre-conversion
    // route returned the computed masking plan directly in its synchronous
    // response body. sandbox/f3-apply.ts's apply_sandbox_2 still computes
    // `plan` (via buildMaskingPlan) but the function's return type is now
    // `Promise<void>` — the plan is discarded, never persisted anywhere
    // (repo.insertRefreshJob is not given maskedFieldCount/preservedFieldCount
    // either, so even those job columns stay at their DB default instead of
    // the computed values) and never echoed in the 202 response. There is no
    // real persisted value left to verify these assertions against without
    // route/consumer changes (out of scope for this batch).
    const plan = job.plan;
    expect(plan).toBeDefined();
    expect(plan?.maskedFieldCount).toBe(2);
    expect(plan?.preservedFieldCount).toBe(1);
    expect(plan?.defaultedFields).toEqual([{ tableName: "citizens", fieldName: "aadhaar" }]);
    const aadhaar = plan?.fields.find((f) => f.fieldName === "aadhaar");
    expect(aadhaar?.strategy).toBe("redact");
    expect(aadhaar?.ruleSource).toBe("default");
  });

  it("does not move any data — the job records dataMovement 'stubbed'", async () => {
    const s = await register(nextCode("stub"));
    const job = await requestRefresh(s.id, [{ tableName: "t", fieldName: "f" }]);
    const rows = await asTenant(T_MAIN, (sql) => sql<Array<{ data_movement: string }>>`
      SELECT data_movement FROM sandbox.refresh_jobs WHERE id = ${job.id}`);
    expect(rows[0]?.data_movement).toBe("stubbed");
  });

  it("400 when requestedFields is empty", async () => {
    const s = await register(nextCode("empty"));
    const res = await app.inject({
      method: "POST", url: `/v1/admin/sandboxes/${s.id}/refreshes`, headers: auth(MAKER),
      payload: { requestedFields: [] },
    });
    expect(res.statusCode).toBe(400);
  });

  it("400 when requestedFields is missing altogether", async () => {
    const s = await register(nextCode("nofields"));
    const res = await app.inject({
      method: "POST", url: `/v1/admin/sandboxes/${s.id}/refreshes`, headers: auth(MAKER), payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it("400 when a requested field name is not a valid identifier", async () => {
    const s = await register(nextCode("badfield"));
    const res = await app.inject({
      method: "POST", url: `/v1/admin/sandboxes/${s.id}/refreshes`, headers: auth(MAKER),
      payload: { requestedFields: [{ tableName: "t", fieldName: "1; --" }] },
    });
    expect(res.statusCode).toBe(400);
  });

  // GAP (not a stale-status-code issue, left unfixed): the refresh-request
  // POST route has no synchronous pre-accept checks at all — no body schema
  // field covers sandbox existence, so an unknown sandbox id is accepted
  // (202); the 404 is only ever thrown inside the async consumer
  // (sandbox/f3-apply.ts's apply_sandbox_2). Same class of gap as the
  // masking-rules 404 GAP above.
  it("404 for an unknown sandbox", async () => {
    const res = await app.inject({
      method: "POST", url: `/v1/admin/sandboxes/${MISSING_ID}/refreshes`, headers: auth(MAKER),
      payload: { requestedFields: [{ tableName: "t", fieldName: "f" }] },
    });
    expect(res.statusCode).toBe(404);
  });

  // GAP (not a stale-status-code issue, left unfixed): assertSandboxRefreshable
  // (SANDBOX_DISABLED / REFRESH_IN_PROGRESS) is only called inside the async
  // consumer (apply_sandbox_2), not synchronously in routes.ts before
  // publish, so a disabled sandbox's refresh request is accepted (202) here.
  it("422 SANDBOX_DISABLED for a disabled sandbox", async () => {
    const s = await register(nextCode("disabled"));
    await asTenant(T_MAIN, (sql) => sql`
      UPDATE sandbox.sandbox_environments SET status = 'disabled' WHERE id = ${s.id}`);
    const res = await app.inject({
      method: "POST", url: `/v1/admin/sandboxes/${s.id}/refreshes`, headers: auth(MAKER),
      payload: { requestedFields: [{ tableName: "t", fieldName: "f" }] },
    });
    expect(res.statusCode).toBe(422);
    expect((res.json() as ErrBody).error.code).toBe("SANDBOX_DISABLED");
  });

  // GAP (not a stale-status-code issue, left unfixed): same missing
  // synchronous assertSandboxRefreshable pre-check as SANDBOX_DISABLED above
  // — a sandbox mid-refresh accepts (202) a second concurrent request too.
  it("409 REFRESH_IN_PROGRESS while a refresh is already running", async () => {
    const s = await register(nextCode("busy"));
    await asTenant(T_MAIN, (sql) => sql`
      UPDATE sandbox.sandbox_environments SET status = 'refreshing' WHERE id = ${s.id}`);
    const res = await app.inject({
      method: "POST", url: `/v1/admin/sandboxes/${s.id}/refreshes`, headers: auth(MAKER),
      payload: { requestedFields: [{ tableName: "t", fieldName: "f" }] },
    });
    expect(res.statusCode).toBe(409);
    expect((res.json() as ErrBody).error.code).toBe("REFRESH_IN_PROGRESS");
  });
});

// ── approval lifecycle ─────────────────────────────────────────────────────

describe("sandbox refresh — approve / reject", () => {
  it("202 for a distinct approver, flipping the job to queued and the sandbox to refreshing", async () => {
    const s = await register(nextCode("approve"));
    const job = await requestRefresh(s.id, [{ tableName: "t", fieldName: "f" }]);
    const res = await app.inject({
      method: "POST", url: `/v1/admin/sandbox-refreshes/${job.id}/approve`,
      headers: auth(CHECKER), payload: { expectedVersion: job.version },
    });
    expect(res.statusCode).toBe(202);
    // 202 command-acknowledgement envelope — "queued"/version only exist once
    // the async consumer (sandbox/f3-apply.ts's apply_sandbox_3) applies the
    // write; verified below via the real persisted job/sandbox instead of the
    // synchronous response body (which is just {id, status:"accepted", ...}).
    expect((res.json() as { status: string }).status).toBe("accepted");
    await (queue as any).drain?.();

    const jobAfter = await app.inject({
      method: "GET", url: `/v1/admin/sandbox-refreshes/${job.id}`, headers: auth(CHECKER),
    });
    expect((jobAfter.json() as SingleBody<Job>).data).toMatchObject({ status: "queued", version: job.version + 1 });

    const after = await app.inject({ method: "GET", url: `/v1/admin/sandboxes/${s.id}`, headers: auth(CHECKER) });
    expect((after.json() as SingleBody<Sandbox>).data.status).toBe("refreshing");
  });

  it("publishes exactly one execute command on the outbox for one approval", async () => {
    const s = await register(nextCode("cmd"));
    const job = await requestRefresh(s.id, [{ tableName: "t", fieldName: "f" }]);
    const res = await app.inject({
      method: "POST", url: `/v1/admin/sandbox-refreshes/${job.id}/approve`,
      headers: auth(CHECKER), payload: { expectedVersion: job.version },
    });
    expect(res.statusCode).toBe(202);
    // The `enqueue()` call that writes _outbox.messages happens inside the
    // async consumer's transaction (apply_sandbox_3), not synchronously in
    // the route — land it before reading the outbox table.
    await (queue as any).drain?.();
    // _outbox.messages is RLS-forced too, so the read needs the tenant GUC.
    const rows = await asTenant(T_MAIN, (sql) => sql<Array<{ n: number }>>`
      SELECT count(*)::int AS n FROM _outbox.messages
      WHERE topic = 'admin.sandbox_refresh.execute' AND payload->>'jobId' = ${job.id}`);
    expect(rows[0]?.n).toBe(1);
  });

  // GAP (not a stale-status-code issue, left unfixed): approve's
  // maker-checker check (assertApproverDistinct) is only called inside the
  // async consumer (apply_sandbox_3), not synchronously in routes.ts before
  // publish — unlike masking-rules' assertPreserveJustified — so a
  // self-approval is accepted (202) here and only silently rejected later
  // inside the consumer, with no channel back to the HTTP caller.
  it("409 MAKER_CHECKER_VIOLATION when the requester self-approves", async () => {
    const s = await register(nextCode("sod"));
    const job = await requestRefresh(s.id, [{ tableName: "t", fieldName: "f" }]);
    const res = await app.inject({
      method: "POST", url: `/v1/admin/sandbox-refreshes/${job.id}/approve`,
      headers: auth(MAKER), payload: { expectedVersion: job.version },
    });
    expect(res.statusCode).toBe(409);
    expect((res.json() as ErrBody).error.code).toBe("MAKER_CHECKER_VIOLATION");
  });

  // GAP (not a stale-status-code issue, left unfixed): assertVersionMatch is
  // only called inside the async consumer (apply_sandbox_3); routes.ts's
  // decideBody schema only coerces expectedVersion to a number, it does not
  // compare it against the job's current version, so a stale expectedVersion
  // is accepted (202) here.
  it("409 VERSION_CONFLICT on a stale expectedVersion", async () => {
    const s = await register(nextCode("stale"));
    const job = await requestRefresh(s.id, [{ tableName: "t", fieldName: "f" }]);
    const res = await app.inject({
      method: "POST", url: `/v1/admin/sandbox-refreshes/${job.id}/approve`,
      headers: auth(CHECKER), payload: { expectedVersion: job.version + 7 },
    });
    expect(res.statusCode).toBe(409);
    expect((res.json() as ErrBody).error.code).toBe("VERSION_CONFLICT");
  });

  // GAP (not a stale-status-code issue, left unfixed): assertAwaitingApproval
  // is only called inside the async consumer (apply_sandbox_3); routes.ts has
  // no synchronous pre-check of the job's current status, so a second
  // approve of an already-queued job is accepted (202) here too. The first
  // approve is still landed for realism before the (documented-failing)
  // second one.
  it("409 NOT_PENDING_APPROVAL when approving twice", async () => {
    const s = await register(nextCode("twice"));
    const job = await requestRefresh(s.id, [{ tableName: "t", fieldName: "f" }]);
    await app.inject({
      method: "POST", url: `/v1/admin/sandbox-refreshes/${job.id}/approve`,
      headers: auth(CHECKER), payload: { expectedVersion: job.version },
    });
    await (queue as any).drain?.();
    const again = await app.inject({
      method: "POST", url: `/v1/admin/sandbox-refreshes/${job.id}/approve`,
      headers: auth(CHECKER), payload: { expectedVersion: job.version + 1 },
    });
    expect(again.statusCode).toBe(409);
    expect((again.json() as ErrBody).error.code).toBe("NOT_PENDING_APPROVAL");
  });

  it("400 when expectedVersion is absent", async () => {
    const s = await register(nextCode("noexp"));
    const job = await requestRefresh(s.id, [{ tableName: "t", fieldName: "f" }]);
    const res = await app.inject({
      method: "POST", url: `/v1/admin/sandbox-refreshes/${job.id}/approve`,
      headers: auth(CHECKER), payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  // GAP (not a stale-status-code issue, left unfixed): the job-existence
  // check (repo.findRefreshJobTx) is only inside the async consumer
  // (apply_sandbox_3); routes.ts's idParam schema only validates that the id
  // is a UUID, not that it exists, so an unknown job id is accepted (202).
  it("404 when approving an unknown job", async () => {
    const res = await app.inject({
      method: "POST", url: `/v1/admin/sandbox-refreshes/${MISSING_ID}/approve`,
      headers: auth(CHECKER), payload: { expectedVersion: 1 },
    });
    expect(res.statusCode).toBe(404);
  });

  it("400 when the job id is not a uuid", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/admin/sandbox-refreshes/abc/approve",
      headers: auth(CHECKER), payload: { expectedVersion: 1 },
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects a request with a reason and refuses a later approve", async () => {
    const s = await register(nextCode("reject"));
    const job = await requestRefresh(s.id, [{ tableName: "t", fieldName: "f" }]);
    const rej = await app.inject({
      method: "POST", url: `/v1/admin/sandbox-refreshes/${job.id}/reject`,
      headers: auth(CHECKER), payload: { expectedVersion: job.version, reason: "production source not authorised" },
    });
    expect(rej.statusCode).toBe(202);
    expect((rej.json() as { status: string }).status).toBe("accepted");
    await (queue as any).drain?.();

    const jobAfter = await app.inject({
      method: "GET", url: `/v1/admin/sandbox-refreshes/${job.id}`, headers: auth(CHECKER),
    });
    expect((jobAfter.json() as SingleBody<Job>).data.status).toBe("rejected");

    // GAP (not a stale-status-code issue, left unfixed): same missing
    // synchronous assertAwaitingApproval pre-check as the "approving twice"
    // GAP above — approving an already-rejected job is accepted (202) here
    // too, and the NOT_PENDING_APPROVAL conflict is only enforced inside the
    // async consumer.
    const after = await app.inject({
      method: "POST", url: `/v1/admin/sandbox-refreshes/${job.id}/approve`,
      headers: auth(CHECKER), payload: { expectedVersion: job.version + 1 },
    });
    expect(after.statusCode).toBe(409);
    expect((after.json() as ErrBody).error.code).toBe("NOT_PENDING_APPROVAL");
  });

  it("400 when a reject omits the reason", async () => {
    const s = await register(nextCode("noreason"));
    const job = await requestRefresh(s.id, [{ tableName: "t", fieldName: "f" }]);
    const res = await app.inject({
      method: "POST", url: `/v1/admin/sandbox-refreshes/${job.id}/reject`,
      headers: auth(CHECKER), payload: { expectedVersion: job.version },
    });
    expect(res.statusCode).toBe(400);
  });

  // GAP (not a stale-status-code issue, left unfixed): reject shares
  // apply_sandbox_4's assertApproverDistinct check, which — like approve's —
  // only runs inside the async consumer, not synchronously in routes.ts, so
  // a self-reject is accepted (202) here.
  it("409 MAKER_CHECKER_VIOLATION when the requester rejects their own request", async () => {
    const s = await register(nextCode("selfreject"));
    const job = await requestRefresh(s.id, [{ tableName: "t", fieldName: "f" }]);
    const res = await app.inject({
      method: "POST", url: `/v1/admin/sandbox-refreshes/${job.id}/reject`,
      headers: auth(MAKER), payload: { expectedVersion: job.version, reason: "mistake" },
    });
    expect(res.statusCode).toBe(409);
  });

  // GAP (not a stale-status-code issue, left unfixed): same missing
  // synchronous job-existence pre-check as approve's 404 GAP above —
  // rejecting an unknown job id is accepted (202) here.
  it("404 when rejecting an unknown job", async () => {
    const res = await app.inject({
      method: "POST", url: `/v1/admin/sandbox-refreshes/${MISSING_ID}/reject`,
      headers: auth(CHECKER), payload: { expectedVersion: 1, reason: "nope" },
    });
    expect(res.statusCode).toBe(404);
  });
});

// ── job reads ──────────────────────────────────────────────────────────────

describe("sandbox refresh — reads", () => {
  it("lists jobs, filtered by status and sandbox", async () => {
    const s = await register(nextCode("list"));
    const job = await requestRefresh(s.id, [{ tableName: "t", fieldName: "f" }]);
    const res = await app.inject({
      method: "GET", url: `/v1/admin/sandbox-refreshes?limit=100&status=pending_approval&sandboxId=${s.id}`,
      headers: auth(CHECKER),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as ListBody<Job>;
    expect(body.data.map((r) => r.id)).toContain(job.id);
    expect(body.data.every((r) => r.status === "pending_approval")).toBe(true);
  });

  it("400 for an unknown status filter", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/admin/sandbox-refreshes?limit=10&status=exploded", headers: auth(CHECKER),
    });
    expect(res.statusCode).toBe(400);
  });

  it("400 for a non-uuid sandboxId filter", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/admin/sandbox-refreshes?limit=10&sandboxId=nope", headers: auth(CHECKER),
    });
    expect(res.statusCode).toBe(400);
  });

  it("reads a single job, 404 for an unknown one", async () => {
    const s = await register(nextCode("one"));
    const job = await requestRefresh(s.id, [{ tableName: "t", fieldName: "f" }]);
    const ok = await app.inject({ method: "GET", url: `/v1/admin/sandbox-refreshes/${job.id}`, headers: auth(CHECKER) });
    expect(ok.statusCode).toBe(200);
    expect((ok.json() as SingleBody<Job>).data.id).toBe(job.id);

    const missing = await app.inject({
      method: "GET", url: `/v1/admin/sandbox-refreshes/${MISSING_ID}`, headers: auth(CHECKER),
    });
    expect(missing.statusCode).toBe(404);
  });

  it("returns an empty masked-field list before the refresh has executed", async () => {
    const s = await register(nextCode("masked"));
    const job = await requestRefresh(s.id, [{ tableName: "t", fieldName: "f" }]);
    const res = await app.inject({
      method: "GET", url: `/v1/admin/sandbox-refreshes/${job.id}/masked-fields?limit=50`, headers: auth(CHECKER),
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as ListBody<PlannedField>).meta.total).toBe(0);
  });

  it("404 for masked fields of an unknown job", async () => {
    const res = await app.inject({
      method: "GET", url: `/v1/admin/sandbox-refreshes/${MISSING_ID}/masked-fields?limit=10`, headers: auth(CHECKER),
    });
    expect(res.statusCode).toBe(404);
  });

  it("does not expose another tenant's refresh job", async () => {
    const s = await register(nextCode("crosstenant"), T_ALT);
    const job = await requestRefresh(s.id, [{ tableName: "t", fieldName: "f" }], T_ALT);
    const res = await app.inject({
      method: "GET", url: `/v1/admin/sandbox-refreshes/${job.id}`, headers: auth(CHECKER, ["tenant_admin"], T_MAIN),
    });
    expect(res.statusCode).toBe(404);
  });
});
