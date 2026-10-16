/**
 * Risk HTTP route/command layer coverage — audit-service
 *
 * Existing tests/risk.test.ts covers pure domain logic (computeRiskScore /
 * riskBand) and POST /v1/audit/risks route auth well, but does not cover
 * PATCH /v1/audit/risks/:id, GET /v1/audit/risks/universe,
 * POST /v1/audit/plans/:id/risks, or GET /v1/audit/plans/:id/risks — this
 * file fills that route/command-layer gap (risk/commands.ts at 38.7% lines,
 * risk/routes.ts at 54.54%).
 *
 * Also confirms the createRiskBody accepted-payload shape does NOT include
 * riskScore — server-side computation (domain.ts's computeRiskScore) is the
 * only source of truth for that field, so a client-supplied riskScore is
 * simply ignored by the validator/parse step rather than rejected with 400.
 *
 * Test-harness patterns follow tests/plan.test.ts / tests/risk.test.ts
 * (runWithTenant + db.transaction seeding/cleanup) and
 * tests/rls-isolation.test.ts (app.inject + signToken).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { createRiskBody } from "../src/modules/risk/validators.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
function token(roles: string[], tenantId: string, actorId: string) {
  return signToken({ sub: actorId, tid: tenantId, roles, sid: "sess-1" }, SECRET, 3600);
}

const TENANT = randomUUID();
const ACTOR = randomUUID();
const PLAN_ID = randomUUID();
const RISK_ID_A = randomUUID();
const RISK_ID_B = randomUUID();

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp();
});

afterAll(async () => {
  await app.close();
  await sqlClient.end();
});

describe("createRiskBody — riskScore is not client-controllable", () => {
  it("the accepted payload shape has no riskScore field at all (server computes it via domain.ts)", () => {
    expect(Object.keys(createRiskBody.shape)).not.toContain("riskScore");
  });

  it("a client-supplied riskScore is stripped (not preserved) by parsing, proving the client cannot influence it", () => {
    const parsed = createRiskBody.parse({
      riskCode: "RC-STRIP-1", title: "Strip test", likelihood: "possible", impact: "moderate",
      riskScore: 999999,
    });
    expect((parsed as Record<string, unknown>).riskScore).toBeUndefined();
  });
});

describe("POST /v1/audit/risks", () => {
  it("401 when no bearer token is supplied", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/audit/risks",
      payload: { riskCode: "RC-NOAUTH", title: "No Auth", likelihood: "possible", impact: "moderate" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("403 for a role without write access (employee)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/audit/risks",
      headers: { authorization: `Bearer ${token(["employee"], TENANT, ACTOR)}`, "content-type": "application/json" },
      payload: { riskCode: "RC-WRONGROLE", title: "Wrong Role", likelihood: "possible", impact: "moderate" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("202 for audit_officer with valid likelihood/impact", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/audit/risks",
      headers: { authorization: `Bearer ${token(["audit_officer"], TENANT, ACTOR)}`, "content-type": "application/json" },
      payload: {
        riskCode: `RC-VALID-${Date.now()}`, title: "Valid risk", likelihood: "likely", impact: "major",
      },
    });
    expect(res.statusCode).toBe(202);
    const body = res.json();
    expect(body.status).toBe("accepted");
    expect(typeof body.id).toBe("string");
    expect(body.correlationId).toBeDefined();
  });

  it("400 for an invalid likelihood enum value", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/audit/risks",
      headers: { authorization: `Bearer ${token(["audit_officer"], TENANT, ACTOR)}`, "content-type": "application/json" },
      payload: {
        riskCode: "RC-BADLIKELIHOOD", title: "Bad likelihood", likelihood: "super_duper_likely", impact: "moderate",
      },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.code).toBe("VALIDATION_FAILED");
  });
});

describe("PATCH /v1/audit/risks/:id", () => {
  it("401 when no bearer token is supplied", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/audit/risks/${RISK_ID_A}`,
      payload: { status: "closed" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("403 for a role without write access (employee)", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/audit/risks/${RISK_ID_A}`,
      headers: { authorization: `Bearer ${token(["employee"], TENANT, ACTOR)}`, "content-type": "application/json" },
      payload: { status: "closed" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("202 for audit_officer with a valid partial update", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/audit/risks/${RISK_ID_A}`,
      headers: { authorization: `Bearer ${token(["audit_officer"], TENANT, ACTOR)}`, "content-type": "application/json" },
      payload: { mitigationStatus: "in_progress" },
    });
    expect(res.statusCode).toBe(202);
    const body = res.json();
    expect(body.status).toBe("accepted");
    expect(body.id).toBe(RISK_ID_A);
  });

  it("400 for an empty body (at least one field required)", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/audit/risks/${RISK_ID_A}`,
      headers: { authorization: `Bearer ${token(["audit_officer"], TENANT, ACTOR)}`, "content-type": "application/json" },
      payload: {},
    });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.code).toBe("VALIDATION_FAILED");
  });
});

describe("GET /v1/audit/risks/universe", () => {
  it("401 when no bearer token is supplied", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/audit/risks/universe" });
    expect(res.statusCode).toBe(401);
  });

  it("403 for a role without read access (employee)", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/audit/risks/universe",
      headers: { authorization: `Bearer ${token(["employee"], TENANT, ACTOR)}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it("200 and returns an array response", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/audit/risks/universe",
      headers: { authorization: `Bearer ${token(["audit_officer"], TENANT, ACTOR)}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body)).toBe(true);
  });

  it("200 for a reader-only role (finance_admin)", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/audit/risks/universe",
      headers: { authorization: `Bearer ${token(["finance_admin"], TENANT, ACTOR)}` },
    });
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json())).toBe(true);
  });
});

describe("POST /v1/audit/plans/:id/risks (link risks to plan)", () => {
  it("401 when no bearer token is supplied", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/audit/plans/${PLAN_ID}/risks`,
      payload: { riskIds: [RISK_ID_A] },
    });
    expect(res.statusCode).toBe(401);
  });

  it("403 for a role without write access (employee)", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/audit/plans/${PLAN_ID}/risks`,
      headers: { authorization: `Bearer ${token(["employee"], TENANT, ACTOR)}`, "content-type": "application/json" },
      payload: { riskIds: [RISK_ID_A] },
    });
    expect(res.statusCode).toBe(403);
  });

  it("202 for audit_officer with a valid riskIds array", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/audit/plans/${PLAN_ID}/risks`,
      headers: { authorization: `Bearer ${token(["audit_officer"], TENANT, ACTOR)}`, "content-type": "application/json" },
      payload: { riskIds: [RISK_ID_A, RISK_ID_B] },
    });
    expect(res.statusCode).toBe(202);
    const body = res.json();
    expect(body.status).toBe("accepted");
    expect(body.id).toBe(PLAN_ID);
  });

  it("400 for an empty riskIds array", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/audit/plans/${PLAN_ID}/risks`,
      headers: { authorization: `Bearer ${token(["audit_officer"], TENANT, ACTOR)}`, "content-type": "application/json" },
      payload: { riskIds: [] },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.code).toBe("VALIDATION_FAILED");
  });
});

describe("GET /v1/audit/plans/:id/risks", () => {
  it("401 when no bearer token is supplied", async () => {
    const res = await app.inject({ method: "GET", url: `/v1/audit/plans/${PLAN_ID}/risks` });
    expect(res.statusCode).toBe(401);
  });

  it("403 for a role without read access (employee)", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/audit/plans/${PLAN_ID}/risks`,
      headers: { authorization: `Bearer ${token(["employee"], TENANT, ACTOR)}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it("200 and returns an array response", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/audit/plans/${PLAN_ID}/risks`,
      headers: { authorization: `Bearer ${token(["audit_officer"], TENANT, ACTOR)}` },
    });
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json())).toBe(true);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// GAP-AUDIT-RISK-REGISTER-07 — POST /v1/audit/risks writes exactly one
//   audit event per mutation
//
// Given: a riskCreate command driven through the full consumer pipeline
//   (risk consumer + audit consumer);
// When: the queue is drained;
// Then: exactly one audit_events row is created with target = the new risk id
//   and action = "create".
// ──────────────────────────────────────────────────────────────────────────────
describe("GAP-AUDIT-RISK-REGISTER-07 — POST /v1/audit/risks writes exactly one audit event", () => {
  const R07_TENANT = randomUUID();
  const R07_ACTOR  = randomUUID();

  let MemQR: typeof import("@civitasone/queue")["MemoryQueue"];
  let withTenantConsR: typeof import("@civitasone/db")["withTenantConsumer"];
  let auditEvtsR: typeof import("../src/modules/events/schema.js")["auditEvents"];
  let dbInstR: typeof import("../src/shared/db.js")["db"];
  let regRisk: typeof import("../src/modules/risk/consumer.js")["registerRiskConsumers"];
  let regAuditR: typeof import("../src/modules/events/consumer.js")["registerAuditConsumers"];
  let runWTR: typeof import("@civitasone/db")["runWithTenant"];

  function wireTenantQR(q: import("@civitasone/queue").Queue): import("@civitasone/queue").Queue {
    const raw = q.subscribe.bind(q);
    q.subscribe = ((topic: string, handler: import("@civitasone/queue").Handler) =>
      raw(topic, withTenantConsR(handler) as import("@civitasone/queue").Handler)) as typeof q.subscribe;
    return q;
  }

  beforeAll(async () => {
    ({ MemoryQueue: MemQR } = await import("@civitasone/queue"));
    ({ withTenantConsumer: withTenantConsR } = await import("@civitasone/db"));
    ({ auditEvents: auditEvtsR } = await import("../src/modules/events/schema.js"));
    ({ db: dbInstR } = await import("../src/shared/db.js"));
    ({ registerRiskConsumers: regRisk } = await import("../src/modules/risk/consumer.js"));
    ({ registerAuditConsumers: regAuditR } = await import("../src/modules/events/consumer.js"));
    ({ runWithTenant: runWTR } = await import("@civitasone/db"));
  });

  it("exactly one audit event is written when a risk is created", async () => {
    const riskId = randomUUID();
    const q = wireTenantQR(new MemQR());
    regRisk(q);
    regAuditR(q);
    await q.start();

    await q.publish("audit.risk.create", {
      messageId: riskId, type: "audit.risk.create",
      tenantId: R07_TENANT, actorId: R07_ACTOR,
      correlationId: randomUUID(), schemaVersion: "1.0",
      payload: {
        id: riskId, tenantId: R07_TENANT,
        riskCode: `RC-AUD-${Date.now()}`, title: "Audit event risk test",
        likelihood: "likely", impact: "major",
      },
    });
    await new Promise<void>((r) => setTimeout(r, 700));
    await q.stop();

    const { eq: eqFn } = await import("drizzle-orm");
    const events = await runWTR(R07_TENANT, () =>
      dbInstR.transaction((tx) =>
        tx.select().from(auditEvtsR).where(eqFn(auditEvtsR.tenantId, R07_TENANT)).limit(20),
      ),
    );
    const createEvents = events.filter(
      (r) =>
        r.target === riskId &&
        typeof r.payload === "object" &&
        r.payload !== null &&
        (r.payload as Record<string, unknown>)["action"] === "create",
    );
    expect(createEvents).toHaveLength(1);
  });
});
