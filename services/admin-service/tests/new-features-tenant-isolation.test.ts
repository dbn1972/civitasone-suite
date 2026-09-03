/**
 * Cross-tenant isolation for the five BRD rows added in this sprint:
 *   WC-009 sandbox environments + masked refresh
 *   WC-010 configuration-as-artefact
 *   CR-MOB-01 mobile app performance monitoring
 *   ORG-07 department template clone
 *   DM-002 document types, mandatory documents, expiry alerting
 *
 * The per-module test files already cover happy paths, 400/401/403/404/409/422
 * and the domain branches. What they do NOT do behaviourally is prove that a
 * token minted for tenant A can neither READ nor MUTATE tenant B's rows. Every
 * table here is RLS-forced, but RLS is only the second line of defence: the
 * route's own `WHERE tenant_id = ctx.tenantId` is the first, and a route that
 * forgot it would still pass a single-tenant test suite.
 *
 * So each block below seeds a row as tenant A and then drives the SAME route
 * with a tenant B token, asserting 404 (never 200 with A's data, never a
 * successful write) and empty list totals. Cross-tenant reads and writes are
 * exercised separately, because a leak on the write path is the more dangerous
 * of the two.
 *
 * Real Postgres, real Fastify via app.inject(), no network.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";

const { buildApp } = await import("../src/app.js");
const { sqlClient, db } = await import("../src/shared/db.js");
const { queue } = await import("../src/shared/infra.js");
const { tenantScoped } = await import("../src/shared/tenant-queue.js");
const { markProcessed } = await import("../src/shared/outbox.js");
const { COMMANDS } = await import("../src/topics.js");
const { registerMobileTelemetryConsumers } = await import("../src/modules/health/mobile-consumer.js");
const { apply_sandbox_0, apply_sandbox_1, apply_sandbox_2, apply_sandbox_3, apply_sandbox_4 } =
  await import("../src/modules/sandbox/f3-apply.js");
const { apply_config_0, apply_config_1, apply_config_2, apply_config_3, apply_config_4 } =
  await import("../src/modules/config/artefact-f3-apply.js");
const { apply_dept_templates_0, apply_dept_templates_1, apply_dept_templates_2 } =
  await import("../src/modules/dept-templates/f3-apply.js");
const { apply_uploads_0, apply_uploads_1, apply_uploads_2, apply_uploads_3, apply_uploads_4 } =
  await import("../src/modules/uploads/doc-f3-apply.js");

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";

/** Distinct from every other test file's tenants — files run in parallel. */
const T_A = "15015000-0000-4000-8000-0000000000a1";
const T_B = "15015000-0000-4000-8000-0000000000b1";
const TENANTS = [T_A, T_B];

const A_MAKER = "15011111-0000-4000-8000-00000000000a";
const A_CHECKER = "15012222-0000-4000-8000-00000000000b";
const B_ACTOR = "15013333-0000-4000-8000-00000000000c";

function auth(
  actorId: string,
  tenantId: string,
  roles: string[] = ["tenant_admin"],
): { authorization: string } {
  return {
    authorization: `Bearer ${signToken({ sub: actorId, tid: tenantId, roles, sid: "sess-iso" }, SECRET, 3600)}`,
  };
}

const A = (): { authorization: string } => auth(A_MAKER, T_A);
const A2 = (): { authorization: string } => auth(A_CHECKER, T_A);
const B = (): { authorization: string } => auth(B_ACTOR, T_B);

/** Raw SQL with the RLS GUC set — admin_svc is NOBYPASSRLS. */
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
      await sql`DELETE FROM sandbox.refresh_masked_fields WHERE tenant_id = ${t}`;
      await sql`DELETE FROM sandbox.refresh_jobs WHERE tenant_id = ${t}`;
      await sql`DELETE FROM sandbox.masking_rules WHERE tenant_id = ${t}`;
      await sql`DELETE FROM sandbox.sandbox_environments WHERE tenant_id = ${t}`;
      await sql`DELETE FROM health.mobile_screen_renders WHERE tenant_id = ${t}`;
      await sql`DELETE FROM health.mobile_telemetry_events WHERE tenant_id = ${t}`;
      await sql`DELETE FROM dept_template.department_instantiations WHERE tenant_id = ${t}`;
      await sql`DELETE FROM dept_template.department_templates WHERE tenant_id = ${t}`;
      await sql`DELETE FROM uploads.documents WHERE tenant_id = ${t}`;
      await sql`DELETE FROM uploads.document_requirements WHERE tenant_id = ${t}`;
      await sql`DELETE FROM uploads.document_types WHERE tenant_id = ${t}`;
    });
  }
}

/**
 * F3 CONSUMER WIRING — this file needs writes from FOUR modules that all
 * publish to the SAME shared topic, COMMANDS.f3RouteWrite
 * ("admin.f3.route_write"): sandbox, config-artefacts, dept-templates and
 * uploads (doc-governance). MemoryQueue's delivery dedup
 * (services/queue-service/src/bus.ts's deliver(), keyed by `topic:messageId`
 * only, not per-handler) means registering more than one handler on that
 * topic in the same Queue instance breaks every handler but the
 * first-registered one — real, pre-existing bug, out of this batch's scope
 * (documented at length in tests/doc-governance-routes.test.ts and
 * tests/sandbox-routes.test.ts's beforeAll comments; a dedicated fix is
 * tracked separately). Every other file in this batch worked around it by
 * registering only the ONE module it needed. This file needs four, so it
 * combines them into a SINGLE subscriber instead: one queue.subscribe() call
 * that dispatches by the `op` prefix and calls each module's own exported
 * apply_<module>_N function directly — the exact same functions each
 * module's own registerF3_<module>_Consumers would have called, just invoked
 * from one shared dispatcher instead of four competing ones. Each module's
 * own markProcessed-timing (claim-after-success for sandbox/config; claim-
 * before for dept-templates/uploads — see each module's own f3-consumer.ts
 * for the SOD-FIX rationale) is preserved exactly.
 */
function registerCombinedSharedTopicConsumer(q: import("@civitasone/queue").Queue): void {
  q.subscribe(COMMANDS.f3RouteWrite, async (msg) => {
    const p = (msg as { payload: Record<string, any> }).payload;
    const op = String(p.op ?? "");
    const ctx = { tenantId: (msg as any).tenantId, actorId: (msg as any).actorId, correlationId: (msg as any).correlationId };
    const req = { body: p.body, params: p.params, query: p.query };
    const messageId = (msg as any).messageId as string;

    if (op.startsWith("sandbox_op_")) {
      switch (op) {
        case "sandbox_op_0": await apply_sandbox_0(ctx, req); break;
        case "sandbox_op_1": await apply_sandbox_1(ctx, req); break;
        case "sandbox_op_2": await apply_sandbox_2(ctx, req); break;
        case "sandbox_op_3": await apply_sandbox_3(ctx, req); break;
        case "sandbox_op_4": await apply_sandbox_4(ctx, req); break;
        default: return;
      }
      await db.transaction(async (tx) => { await markProcessed(tx, messageId); });
    } else if (op.startsWith("config_op_")) {
      switch (op) {
        case "config_op_0": await apply_config_0(ctx, req); break;
        case "config_op_1": await apply_config_1(ctx, req); break;
        case "config_op_2": await apply_config_2(ctx, req); break;
        case "config_op_3": await apply_config_3(ctx, req); break;
        case "config_op_4": await apply_config_4(ctx, req); break;
        default: return;
      }
      await db.transaction(async (tx) => { await markProcessed(tx, messageId); });
    } else if (op.startsWith("dept_templates_op_")) {
      let ok = false;
      await db.transaction(async (tx) => { ok = await markProcessed(tx, messageId); });
      if (!ok) return;
      switch (op) {
        case "dept_templates_op_0": await apply_dept_templates_0(ctx, req); break;
        case "dept_templates_op_1": await apply_dept_templates_1(ctx, req); break;
        case "dept_templates_op_2": await apply_dept_templates_2(ctx, req); break;
      }
    } else if (op.startsWith("uploads_op_")) {
      let ok = false;
      await db.transaction(async (tx) => { ok = await markProcessed(tx, messageId); });
      if (!ok) return;
      switch (op) {
        case "uploads_op_0": await apply_uploads_0(ctx, req); break;
        case "uploads_op_1": await apply_uploads_1(ctx, req); break;
        case "uploads_op_2": await apply_uploads_2(ctx, req); break;
        case "uploads_op_3": await apply_uploads_3(ctx, req); break;
        case "uploads_op_4": await apply_uploads_4(ctx, req); break;
      }
    }
    // Any other op prefix (central_config_op_/change_op_/integration_settings_op_/
    // support_op_) belongs to a module this file never exercises — ignored.
  });
}

let app: FastifyInstance;
beforeAll(async () => {
  registerCombinedSharedTopicConsumer(tenantScoped(queue));
  // mobile-telemetry publishes to its OWN dedicated topic (not the shared
  // f3RouteWrite one), so it can be registered normally alongside the
  // combined dispatcher above without hitting the same-topic collision.
  registerMobileTelemetryConsumers(tenantScoped(queue));
  await queue.start();
  app = await buildApp();
  await wipe();
});
afterAll(async () => {
  await wipe();
  await app.close();
  await queue.stop();
  await sqlClient.end();
});

async function drainQueue(): Promise<void> {
  await (queue as any).drain?.();
}

interface SingleBody<T> { data: T }
interface ListBody<T> { data: T[]; meta: { page: number; pageSize: number; total: number } }

function single<T>(res: { json: () => unknown }): T {
  return (res.json() as SingleBody<T>).data;
}
function list<T>(res: { json: () => unknown }): ListBody<T> {
  return res.json() as ListBody<T>;
}

const FUTURE_DAYS = (n: number): string => new Date(Date.now() + n * 86_400_000).toISOString();

// ── WC-009 sandbox ──────────────────────────────────────────────────────────

describe("WC-009 sandbox — cross-tenant isolation", () => {
  interface Sandbox { id: string; code: string; version: number }
  interface Job { id: string; version: number; sandboxId: string }

  let sandboxA: Sandbox;
  let jobA: Job;

  // sandbox/f3-apply.ts's apply_sandbox_0/2 never forward the route-generated
  // id into the DB insert (real, pre-existing, out of this batch's scope —
  // same class of bug documented in tests/sandbox-routes.test.ts). Look the
  // real rows up by content instead of trusting the echoed id.
  async function createSandbox(code: string, actorHeaders: { authorization: string }): Promise<Sandbox> {
    const res = await app.inject({
      method: "POST", url: "/v1/admin/sandboxes", headers: actorHeaders,
      payload: { code, name: `Sandbox ${code}`, sourceEnvironment: "production" },
    });
    expect(res.statusCode).toBe(202);
    await drainQueue();
    const list_ = await app.inject({ method: "GET", url: "/v1/admin/sandboxes?limit=200", headers: actorHeaders });
    const match = (list_.json() as ListBody<Sandbox>).data.find((r) => r.code === code);
    if (!match) throw new Error(`sandbox '${code}' never landed`);
    return match;
  }

  async function requestRefresh(
    sandboxId: string, fields: Array<{ tableName: string; fieldName: string }>, actorHeaders: { authorization: string },
  ): Promise<Job> {
    const res = await app.inject({
      method: "POST", url: `/v1/admin/sandboxes/${sandboxId}/refreshes`, headers: actorHeaders,
      payload: { requestedFields: fields },
    });
    expect(res.statusCode).toBe(202);
    await drainQueue();
    const jobs = await app.inject({
      method: "GET", url: `/v1/admin/sandbox-refreshes?limit=1&status=pending_approval&sandboxId=${sandboxId}`,
      headers: actorHeaders,
    });
    const match = (jobs.json() as ListBody<Job>).data[0];
    if (!match) throw new Error(`refresh request for sandbox ${sandboxId} never landed`);
    return match;
  }

  beforeAll(async () => {
    sandboxA = await createSandbox("iso-sbx", A());
    jobA = await requestRefresh(sandboxA.id, [{ tableName: "citizens", fieldName: "aadhaar" }], A());
  });

  it("tenant B cannot read tenant A's sandbox by id", async () => {
    const res = await app.inject({ method: "GET", url: `/v1/admin/sandboxes/${sandboxA.id}`, headers: B() });
    expect(res.statusCode).toBe(404);
  });

  it("tenant A's sandbox does not appear in tenant B's list", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/admin/sandboxes?limit=200", headers: B() });
    expect(res.statusCode).toBe(200);
    expect(list<Sandbox>(res).meta.total).toBe(0);
  });

  // GAP (not a stale-status-code issue, left unfixed): sandbox/routes.ts's
  // masking-rules POST has no synchronous tenant-scoped existence check on
  // the sandbox id before publish (only assertPreserveJustified, a
  // payload-only check) — same missing-synchronous-pre-validation class as
  // tests/sandbox-routes.test.ts's own masking-rule/refresh/approve/reject
  // GAPs. A cross-tenant attempt is accepted (202) instead of 404.
  it("tenant B cannot add a masking rule to tenant A's sandbox", async () => {
    const res = await app.inject({
      method: "POST", url: `/v1/admin/sandboxes/${sandboxA.id}/masking-rules`, headers: B(),
      payload: { tableName: "citizens", fieldName: "aadhaar", strategy: "preserve", justification: "leak attempt via foreign sandbox id" },
    });
    expect(res.statusCode).toBe(404);
  });

  it("tenant B cannot list tenant A's masking rules", async () => {
    const res = await app.inject({
      method: "GET", url: `/v1/admin/sandboxes/${sandboxA.id}/masking-rules?limit=200`, headers: B(),
    });
    expect(res.statusCode).toBe(404);
  });

  // GAP (not a stale-status-code issue, left unfixed) — same class as the
  // masking-rule GAP above: POST .../refreshes has no synchronous
  // tenant-scoped sandbox-existence check before publish.
  it("tenant B cannot request a refresh against tenant A's sandbox", async () => {
    const res = await app.inject({
      method: "POST", url: `/v1/admin/sandboxes/${sandboxA.id}/refreshes`, headers: B(),
      payload: { requestedFields: [{ tableName: "citizens", fieldName: "pan" }] },
    });
    expect(res.statusCode).toBe(404);
  });

  it("tenant B cannot read tenant A's refresh job", async () => {
    const res = await app.inject({ method: "GET", url: `/v1/admin/sandbox-refreshes/${jobA.id}`, headers: B() });
    expect(res.statusCode).toBe(404);
  });

  // GAP (not a stale-status-code issue, left unfixed) — same class as above:
  // POST .../approve has no synchronous tenant-scoped job-existence check.
  it("tenant B cannot APPROVE tenant A's refresh job", async () => {
    const res = await app.inject({
      method: "POST", url: `/v1/admin/sandbox-refreshes/${jobA.id}/approve`, headers: B(),
      payload: { expectedVersion: jobA.version },
    });
    expect(res.statusCode).toBe(404);

    // and the job is untouched from tenant A's point of view
    const still = await app.inject({ method: "GET", url: `/v1/admin/sandbox-refreshes/${jobA.id}`, headers: A() });
    expect(single<{ status: string; approvedBy: string | null }>(still).status).toBe("pending_approval");
    expect(single<{ approvedBy: string | null }>(still).approvedBy).toBeNull();
  });

  // GAP (not a stale-status-code issue, left unfixed) — same class as above.
  it("tenant B cannot REJECT tenant A's refresh job", async () => {
    const res = await app.inject({
      method: "POST", url: `/v1/admin/sandbox-refreshes/${jobA.id}/reject`, headers: B(),
      payload: { expectedVersion: jobA.version, reason: "cross-tenant reject attempt" },
    });
    expect(res.statusCode).toBe(404);
  });

  it("tenant B cannot read the masked-field record of tenant A's job", async () => {
    const res = await app.inject({
      method: "GET", url: `/v1/admin/sandbox-refreshes/${jobA.id}/masked-fields?limit=200`, headers: B(),
    });
    expect(res.statusCode).toBe(404);
  });

  it("tenant A's refresh job does not appear in tenant B's job list", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/admin/sandbox-refreshes?limit=200", headers: B() });
    expect(list<Job>(res).meta.total).toBe(0);
  });

  it("the same sandbox code is free in the other tenant", async () => {
    const created = await createSandbox("iso-sbx", B());
    expect(created.id).not.toBe(sandboxA.id);
  });
});

// ── WC-010 config artefacts ─────────────────────────────────────────────────

describe("WC-010 config artefacts — cross-tenant isolation", () => {
  interface Artefact { id: string; artefactVersion: number }
  interface Promotion { id: string; version: number; setKey: string; artefactVersion: number; targetEnv: string }

  const SET = "iso.app";
  let artefactA: Artefact;
  let promotionA: Promotion;

  // config/artefact-f3-apply.ts's apply_config_0/1 never forward the
  // route-generated id — same class of bug as tests/config-artefacts-routes.test.ts's
  // snapshot()/requestPromotion() (real, pre-existing, out of this batch's
  // scope). Look the real rows up by content instead of trusting the echo.
  async function snapshot(setKey: string, entries: Record<string, unknown>, actorHeaders: { authorization: string }): Promise<Artefact> {
    const res = await app.inject({
      method: "POST", url: "/v1/admin/config-artefacts", headers: actorHeaders,
      payload: { setKey, entries },
    });
    expect(res.statusCode).toBe(202);
    await drainQueue();
    const list_ = await app.inject({
      method: "GET", url: `/v1/admin/config-artefacts?limit=200&setKey=${encodeURIComponent(setKey)}`, headers: actorHeaders,
    });
    const match = (list_.json() as ListBody<Artefact>).data[0];
    if (!match) throw new Error(`snapshot for '${setKey}' never landed`);
    return match;
  }

  async function requestPromotion(
    setKey: string, artefactVersion: number, targetEnv: string, actorHeaders: { authorization: string },
  ): Promise<Promotion> {
    const res = await app.inject({
      method: "POST", url: "/v1/admin/config-artefacts/promotions", headers: actorHeaders,
      payload: { setKey, artefactVersion, targetEnv },
    });
    expect(res.statusCode).toBe(202);
    await drainQueue();
    const list_ = await app.inject({
      method: "GET", url: "/v1/admin/config-artefacts/promotions?limit=200&status=pending", headers: actorHeaders,
    });
    const match = (list_.json() as ListBody<Promotion>).data
      .find((r) => r.setKey === setKey && r.artefactVersion === artefactVersion && r.targetEnv === targetEnv);
    if (!match) throw new Error(`promotion request for '${setKey}' -> ${targetEnv} never landed`);
    return match;
  }

  beforeAll(async () => {
    artefactA = await snapshot(SET, { featureX: true }, A());
    promotionA = await requestPromotion(SET, artefactA.artefactVersion, "production", A());
  });

  it("tenant B cannot read tenant A's artefact by id", async () => {
    const res = await app.inject({ method: "GET", url: `/v1/admin/config-artefacts/${artefactA.id}`, headers: B() });
    expect(res.statusCode).toBe(404);
  });

  it("tenant B cannot diff tenant A's set", async () => {
    const res = await app.inject({
      method: "GET", url: `/v1/admin/config-artefacts/diff?setKey=${SET}&fromVersion=1&toVersion=1`, headers: B(),
    });
    // config-artefacts/routes.ts's diff endpoint DOES tenant-scope its
    // existence check (repo.findArtefactByVersion(ctx.tenantId, ...)) before
    // its unrelated "computes the diff then discards it, returns an empty
    // 202" bug (out of this batch's scope, being fixed separately) even
    // matters — tenant B genuinely has no version 1 of this set, so this 404
    // is real and unaffected by that bug.
    expect(res.statusCode).toBe(404);
  });

  // GAP (not a stale-status-code issue, left unfixed): config-artefacts/
  // routes.ts's promotion approve endpoint has no synchronous tenant-scoped
  // existence check before publish — same missing-synchronous-pre-validation
  // class already documented in tests/config-artefacts-routes.test.ts's
  // maker-checker GAPs.
  it("tenant B cannot APPROVE tenant A's promotion", async () => {
    const res = await app.inject({
      method: "POST", url: `/v1/admin/config-artefacts/promotions/${promotionA.id}/approve`, headers: B(),
      payload: { expectedVersion: promotionA.version },
    });
    expect(res.statusCode).toBe(404);
  });

  // GAP (not a stale-status-code issue, left unfixed) — same class as above.
  it("tenant B cannot REJECT tenant A's promotion", async () => {
    const res = await app.inject({
      method: "POST", url: `/v1/admin/config-artefacts/promotions/${promotionA.id}/reject`, headers: B(),
      payload: { expectedVersion: promotionA.version, reason: "cross-tenant reject attempt" },
    });
    expect(res.statusCode).toBe(404);

    const still = await app.inject({
      method: "GET", url: "/v1/admin/config-artefacts/promotions?limit=200&status=pending", headers: A(),
    });
    expect(list<Promotion>(still).meta.total).toBe(1);
  });

  it("tenant A's promotion is invisible in tenant B's queue", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/admin/config-artefacts/promotions?limit=200", headers: B() });
    expect(list<Promotion>(res).meta.total).toBe(0);
  });

  // GAP (not a stale-status-code issue, left unfixed): rollback has no
  // synchronous guards at all (see tests/config-artefact-rollback-ordering.test.ts's
  // rollback() helper doc comment) — a cross-tenant rollback attempt is
  // accepted (202) here too. The write itself should still be a no-op once
  // the consumer applies it (no env state exists for tenant B to move), so
  // the "A's row untouched" property below is verified for real.
  it("tenant B cannot roll back tenant A's environment", async () => {
    // Make production live for tenant A first, so a rollback target genuinely exists.
    const approved = await app.inject({
      method: "POST", url: `/v1/admin/config-artefacts/promotions/${promotionA.id}/approve`, headers: A2(),
      payload: { expectedVersion: promotionA.version },
    });
    expect(approved.statusCode).toBe(202);
    await drainQueue();

    const res = await app.inject({
      method: "POST", url: "/v1/admin/config-artefacts/environments/production/rollback",
      headers: auth(B_ACTOR, T_B, ["platform_admin"]),
      payload: { setKey: SET, toVersion: 1, expectedVersion: 1 },
    });
    expect(res.statusCode).toBe(404);
    await drainQueue();

    const live = await app.inject({
      method: "GET", url: "/v1/admin/config-artefacts/environments?limit=200", headers: A(),
    });
    expect(list<{ environment: string }>(live).meta.total).toBe(1);
  });

  it("tenant B's environment view stays empty", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/admin/config-artefacts/environments?limit=200", headers: B() });
    expect(list<unknown>(res).meta.total).toBe(0);
  });
});

// ── CR-MOB-01 mobile telemetry ──────────────────────────────────────────────

describe("CR-MOB-01 mobile telemetry — cross-tenant isolation", () => {
  beforeAll(async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/admin/mobile-telemetry", headers: A(),
      payload: {
        appVersion: "1.2.3", platform: "android", coldStartMs: 900,
        crashCount: 1, anrCount: 0, sessionCount: 10,
        recordedAt: new Date().toISOString(),
        screens: [{ screen: "Dashboard", renderMs: 120, sampleCount: 3 }],
      },
    });
    expect(res.statusCode).toBe(202);
    await drainQueue();
  });

  it("tenant B sees none of tenant A's raw events", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/admin/mobile-telemetry?limit=200", headers: B() });
    expect(res.statusCode).toBe(200);
    expect(list<unknown>(res).meta.total).toBe(0);
  });

  it("tenant B's aggregate contains no bucket from tenant A", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/admin/mobile-telemetry/aggregate?limit=200", headers: B() });
    expect(res.statusCode).toBe(200);
    expect(list<unknown>(res).data).toEqual([]);
  });

  it("tenant B's screen view contains no screen from tenant A", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/admin/mobile-telemetry/screens?limit=200", headers: B() });
    expect(res.statusCode).toBe(200);
    expect(list<{ screen: string }>(res).data).toEqual([]);
  });

  it("tenant A still sees its own event and screen bucket", async () => {
    const events = await app.inject({ method: "GET", url: "/v1/admin/mobile-telemetry?limit=200", headers: A() });
    expect(list<unknown>(events).meta.total).toBe(1);
    const screens = await app.inject({ method: "GET", url: "/v1/admin/mobile-telemetry/screens?limit=200", headers: A() });
    expect(list<{ screen: string }>(screens).data.map((s) => s.screen)).toEqual(["Dashboard"]);
  });
});

// ── ORG-07 department template clone ────────────────────────────────────────

describe("ORG-07 department template clone — cross-tenant isolation", () => {
  interface Template { id: string; code: string; version: number; config: Record<string, unknown>; droppedRefs: string[]; status: string }
  interface Instantiation { id: string; departmentCode: string }

  let templateA: Template;

  // dept-templates/f3-apply.ts's apply_dept_templates_0 never forwards the
  // route-generated id — same class of bug as tests/dept-template-routes.test.ts's
  // createTemplate() (real, pre-existing, out of this batch's scope).
  // `foreignTenantRefs` IS echoed synchronously (computed in the route before
  // publish) — captured here since no later GET can recover it; `droppedRefs`
  // IS a persisted column, recovered from the real row below.
  async function createTemplate(
    code: string, config: Record<string, unknown>, actorHeaders: { authorization: string },
  ): Promise<Template & { foreignTenantRefs: string[] }> {
    const res = await app.inject({
      method: "POST", url: "/v1/admin/department-templates", headers: actorHeaders,
      payload: { code, name: `Template ${code}`, config },
    });
    expect(res.statusCode).toBe(202);
    const foreignTenantRefs = single<{ foreignTenantRefs: string[] }>(res).foreignTenantRefs;
    await drainQueue();
    const list_ = await app.inject({ method: "GET", url: "/v1/admin/department-templates?limit=200", headers: actorHeaders });
    const match = (list_.json() as ListBody<Template>).data.find((r) => r.code === code);
    if (!match) throw new Error(`template '${code}' never landed`);
    return { ...match, foreignTenantRefs };
  }

  // GAP: POST .../:id/instantiate has no registered route handler at all in
  // src/modules/dept-templates/routes.ts (dropped by the F3 sync->async
  // conversion commit f113de54, even though the apply function and consumer
  // wiring for it both still exist) — see tests/dept-template-routes.test.ts's
  // "POST /v1/admin/department-templates/:id/instantiate" describe block for
  // the full writeup. A dedicated fix agent is restoring the route
  // separately (out of this batch's scope, not touched here) — every test
  // below that calls this endpoint will 404 until that lands.
  async function instantiate(
    templateId: string, departmentCode: string, idempotencyKey: string, actorHeaders: { authorization: string },
  ): Promise<{ statusCode: number; body: unknown }> {
    const res = await app.inject({
      method: "POST", url: `/v1/admin/department-templates/${templateId}/instantiate`, headers: actorHeaders,
      payload: { departmentCode, departmentName: departmentCode, idempotencyKey },
    });
    return { statusCode: res.statusCode, body: res.json() };
  }

  beforeAll(async () => {
    templateA = await createTemplate("iso-revenue", { workflow: "standard", desks: [{ name: "Front" }] }, A());
  });

  it("tenant B cannot read tenant A's template by id", async () => {
    const res = await app.inject({ method: "GET", url: `/v1/admin/department-templates/${templateA.id}`, headers: B() });
    expect(res.statusCode).toBe(404);
  });

  it("tenant A's template is absent from tenant B's list", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/admin/department-templates?limit=200", headers: B() });
    expect(list<Template>(res).meta.total).toBe(0);
  });

  // GAP (not a stale-status-code issue, left unfixed): dept-templates/
  // routes.ts's PATCH endpoint has no synchronous tenant-scoped existence
  // check before publish (unlike uploads/doc-routes.ts's PATCH document-type,
  // which does) — same missing-synchronous-pre-validation class as
  // tests/dept-template-routes.test.ts's "404 when patching an unknown
  // template" GAP.
  it("tenant B cannot PATCH tenant A's template", async () => {
    const res = await app.inject({
      method: "PATCH", url: `/v1/admin/department-templates/${templateA.id}`, headers: B(),
      payload: { expectedVersion: templateA.version, status: "archived" },
    });
    expect(res.statusCode).toBe(404);

    const still = await app.inject({ method: "GET", url: `/v1/admin/department-templates/${templateA.id}`, headers: A() });
    expect(single<{ status: string }>(still).status).toBe("active");
  });

  // GAP — blocked by the missing instantiate route (see instantiate() above).
  it("tenant B cannot INSTANTIATE tenant A's template", async () => {
    const res = await instantiate(templateA.id, "stolen-dept", "iso-key-0001", B());
    expect(res.statusCode).toBe(404);
  });

  // GAP — blocked by the missing instantiate route (see instantiate() above);
  // the list-instantiations 404 check itself is unreachable without a real
  // instantiation to seed first.
  it("tenant B cannot list tenant A's instantiations", async () => {
    const made = await instantiate(templateA.id, "iso-dept-a", "iso-key-000a", A());
    // instantiate is F3 async: a successful accept is 202, not a synchronous 201
    // (see tests/dept-template-routes.test.ts's instantiate describe block).
    expect(made.statusCode).toBe(202);

    const res = await app.inject({
      method: "GET", url: `/v1/admin/department-templates/${templateA.id}/instantiations?limit=200`, headers: B(),
    });
    expect(res.statusCode).toBe(404);
  });

  it("a clone in tenant B never carries a reference to tenant A", async () => {
    const created = await createTemplate("iso-revenue", { // same code — free in another tenant
      workflow: "standard",
      tenantId: T_A,                       // a foreign tenant reference
      desks: [{ name: "Front", tenant_id: T_A }],
    }, B());

    expect(created.foreignTenantRefs).toEqual(expect.arrayContaining(["tenantId", "desks.0.tenant_id"]));
    expect(created.droppedRefs).toEqual(expect.arrayContaining(["tenantId", "desks.0.tenant_id"]));
    expect(JSON.stringify(created.config)).not.toContain(T_A);
  });

  // GAP — blocked by the missing instantiate route (see instantiate() above).
  it("the same idempotency key in two tenants creates two independent departments", async () => {
    const tplB = await createTemplate("iso-shared-key", { workflow: "std" }, B());

    const inA = await instantiate(templateA.id, "iso-shared-a", "iso-shared-key-1", A());
    const inB = await instantiate(tplB.id, "iso-shared-b", "iso-shared-key-1", B());
    // instantiate is F3 async: a successful accept is 202, not a synchronous 201
    // (see tests/dept-template-routes.test.ts's instantiate describe block).
    expect(inA.statusCode).toBe(202);
    expect(inB.statusCode).toBe(202);
    expect((inA.body as SingleBody<Instantiation>).data.id).not.toBe((inB.body as SingleBody<Instantiation>).data.id);
  });
});

// ── DM-002 document governance ──────────────────────────────────────────────

describe("DM-002 document governance — cross-tenant isolation", () => {
  interface DocType { id: string; code: string; version: number; status: string }
  interface Doc { id: string; status: string; storageKey: string }

  const CTX = { contextType: "employee_onboarding", contextKey: "emp-iso-1" };
  let typeA: DocType;
  let docA: Doc;

  // uploads/doc-f3-apply.ts's create ops (types/requirements/documents) never
  // forward the route-generated id — same class of bug documented in
  // tests/doc-governance-routes.test.ts's createType()/registerDoc().
  async function createType(code: string, over: Record<string, unknown>, actorHeaders: { authorization: string }): Promise<DocType> {
    const res = await app.inject({
      method: "POST", url: "/v1/admin/document-types", headers: actorHeaders,
      payload: { code, name: `Licence ${code}`, ...over },
    });
    expect(res.statusCode).toBe(202);
    await drainQueue();
    const list_ = await app.inject({ method: "GET", url: "/v1/admin/document-types?limit=200", headers: actorHeaders });
    const match = (list_.json() as ListBody<DocType>).data.find((r) => r.code === code);
    if (!match) throw new Error(`document type '${code}' never landed`);
    return match;
  }

  async function createRequirement(
    documentTypeCode: string, mandatory: boolean, actorHeaders: { authorization: string },
  ): Promise<void> {
    const res = await app.inject({
      method: "POST", url: "/v1/admin/document-requirements", headers: actorHeaders,
      payload: { ...CTX, documentTypeCode, mandatory },
    });
    expect(res.statusCode).toBe(202);
    await drainQueue();
  }

  async function registerDoc(over: Record<string, unknown>, actorHeaders: { authorization: string }): Promise<Doc> {
    const storageKey = (over.storageKey as string | undefined) ?? `uploads/iso/${crypto.randomUUID()}.pdf`;
    const res = await app.inject({
      method: "POST", url: "/v1/admin/documents", headers: actorHeaders,
      payload: { ...CTX, ...over, storageKey },
    });
    expect(res.statusCode).toBe(202);
    await drainQueue();
    const list_ = await app.inject({ method: "GET", url: "/v1/admin/documents?limit=200", headers: actorHeaders });
    const match = (list_.json() as ListBody<Doc>).data.find((d) => d.storageKey === storageKey);
    if (!match) throw new Error(`document '${storageKey}' never landed`);
    return match;
  }

  /**
   * The scan route is F3 async too (doc-routes.ts's expiry-scan op) — none of
   * scanned/expiring/expired are echoed synchronously any more. Source the
   * real counters from the 'document.expiry_scan' audit-outbox record the
   * consumer writes in the same transaction as its updates — same technique
   * as tests/doc-expiry-scan-recovery.test.ts's scan().
   */
  async function scan(tenantId: string, actorHeaders: { authorization: string }): Promise<{ scanned: number; expiring: number; expired: number }> {
    const res = await app.inject({
      method: "POST", url: "/v1/admin/documents/expiry-scan", headers: actorHeaders, payload: { limit: 200 },
    });
    expect(res.statusCode).toBe(200);
    await drainQueue();
    const rows = await asTenant(tenantId, (sql) => sql<Array<{ payload: Record<string, unknown> }>>`
      SELECT payload FROM _outbox.messages
      WHERE topic = 'audit.event.record' AND payload->>'action' = 'document.expiry_scan'
      ORDER BY created_at DESC LIMIT 1`);
    const p = rows[0]?.payload ?? {};
    return { scanned: Number(p.scanned ?? 0), expiring: Number(p.expiring ?? 0), expired: Number(p.expired ?? 0) };
  }

  beforeAll(async () => {
    typeA = await createType("iso-licence", { category: "licence", expiryRequired: true, expiryWarnDays: 1, allowedExtensions: ["pdf"] }, A());
    await createRequirement("iso-licence", true, A());
    docA = await registerDoc({
      documentTypeCode: "iso-licence", subjectId: "subj-iso-1",
      storageKey: "uploads/iso/licence.pdf", expiresAt: FUTURE_DAYS(10),
    }, A());
    // warnDays is 1 and expiry is 10 days out, so it registers as `active`.
    expect(docA.status).toBe("active");
  });

  it("tenant B sees none of tenant A's document types", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/admin/document-types?limit=200", headers: B() });
    expect(list<DocType>(res).meta.total).toBe(0);
  });

  it("tenant B sees none of tenant A's requirements", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/admin/document-requirements?limit=200", headers: B() });
    expect(list<unknown>(res).meta.total).toBe(0);
  });

  it("tenant B sees none of tenant A's documents", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/admin/documents?limit=200", headers: B() });
    expect(list<Doc>(res).meta.total).toBe(0);
  });

  it("tenant B cannot PATCH tenant A's document type", async () => {
    // uploads/doc-routes.ts's PATCH document-type DOES carry a synchronous,
    // tenant-scoped existence + version guard (PR #920) — this 404 is real,
    // not a gap.
    const res = await app.inject({
      method: "PATCH", url: `/v1/admin/document-types/${typeA.id}`, headers: B(),
      payload: { expectedVersion: typeA.version, status: "retired" },
    });
    expect(res.statusCode).toBe(404);

    const still = await app.inject({ method: "GET", url: "/v1/admin/document-types?limit=200", headers: A() });
    expect(list<{ status: string }>(still).data[0]?.status).toBe("active");
  });

  it("tenant B cannot read tenant A's compliance report for the same context", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/admin/documents/compliance?limit=200&contextType=${CTX.contextType}&contextKey=${CTX.contextKey}`,
      headers: B(),
    });
    // B has no requirements for that context, so there is nothing to report on.
    expect(res.statusCode).toBe(404);
    expect((res.json() as { error: { code: string } }).error.code).toBe("NO_REQUIREMENTS");
  });

  it("tenant B's expiry scan never touches tenant A's documents", async () => {
    // Widen tenant A's warning window so its document IS due a transition —
    // this makes the negative assertion meaningful rather than vacuous.
    const patched = await app.inject({
      method: "PATCH", url: `/v1/admin/document-types/${typeA.id}`, headers: A(),
      payload: { expectedVersion: typeA.version, expiryWarnDays: 30 },
    });
    expect(patched.statusCode).toBe(200);
    await drainQueue();

    const bResult = await scan(T_B, B());
    expect(bResult.scanned).toBe(0);
    expect(bResult.expiring).toBe(0);
    expect(bResult.expired).toBe(0);

    const afterB = await app.inject({ method: "GET", url: "/v1/admin/documents?limit=200", headers: A() });
    expect(list<Doc>(afterB).data.find((d) => d.id === docA.id)?.status).toBe("active");

    // Tenant A's own scan does move it — proving the scan works and that the
    // preceding no-op was isolation, not a broken scan.
    const aResult = await scan(T_A, A());
    expect(aResult.expiring).toBe(1);

    const afterA = await app.inject({ method: "GET", url: "/v1/admin/documents?limit=200", headers: A() });
    expect(list<Doc>(afterA).data.find((d) => d.id === docA.id)?.status).toBe("expiring");
  });

  it("the same document type code is free in the other tenant", async () => {
    const created = await createType("iso-licence", { category: "licence" }, B());
    expect(created.id).not.toBe(typeA.id);
  });
});
