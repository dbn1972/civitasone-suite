/**
 * audit-service observation module route tests
 *
 * Covers:
 *   POST /v1/audit/observations              — 401 / 403 / 202
 *   POST /v1/audit/observations/:id/reply     — 401 / 403 (outside AUDITEE_ROLES) / 202 (dept_head)
 *   POST /v1/audit/observations/:id/review    — 401 / 403 (outside REVIEW_ROLES) / 202 (audit_admin)
 *   POST /v1/audit/observations/:id/close     — 401 / 403 / 202 (audit_admin)
 *   GET  /v1/audit/observations               — 401 / 403 / 200 (seeded row) / tenant isolation
 *   GET  /v1/audit/observations/:id           — 401 / 403 / 404 (random id) / 200 (seeded row's id)
 *
 * Seeding for the GET tests follows tests/dashboard.test.ts's pattern: direct
 * db.insert() calls run outside any tenant GUC and are rejected by FORCE ROW
 * LEVEL SECURITY, so seeding is wrapped in
 * runWithTenant(TENANT, () => db.transaction((tx) => tx.insert(...))).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { runWithTenant } from "@civitasone/db";
import { relayOnce } from "@civitasone/outbox";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { auditObservations } from "../src/modules/observation/schema.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
function token(roles: string[], tenantId: string, actorId: string) {
  return signToken({ sub: actorId, tid: tenantId, roles, sid: "sess-1" }, SECRET, 3600);
}

const TENANT = randomUUID();
const OTHER_TENANT = randomUUID();
const ACTOR = randomUUID();
const SEEDED_ID = randomUUID();

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp();

  await runWithTenant(TENANT, () => db.transaction((tx) => tx.insert(auditObservations).values({
    id: SEEDED_ID, tenantId: TENANT, obsNo: `OBS-ROUTE-${Date.now()}`, auditeeRef: "dept:finance",
    finding: "Route coverage test observation", category: "financial", riskLevel: "medium",
    amountInvolvedMinor: 50000n, status: "open", createdBy: ACTOR, updatedBy: ACTOR,
  })));
});

afterAll(async () => {
  // auditObservations may carry a DELETE-restriction trigger — best-effort cleanup.
  try {
    await runWithTenant(TENANT, () => db.transaction((tx) => tx.delete(auditObservations).where(eq(auditObservations.id, SEEDED_ID))));
  } catch { /* noop */ }
  await app.close();
  await sqlClient.end();
});

describe("POST /v1/audit/observations", () => {
  const body = { obsNo: `OBS-CREATE-${Date.now()}`, auditeeRef: "dept:finance", finding: "test finding", amountInvolvedMinor: "50000" };

  it("401 without a token", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/audit/observations", payload: body });
    expect(res.statusCode).toBe(401);
  });

  it("403 for a role outside AUDIT_ROLES (employee)", async () => {
    const jwt = token(["employee"], TENANT, ACTOR);
    const res = await app.inject({
      method: "POST", url: "/v1/audit/observations",
      headers: { authorization: `Bearer ${jwt}`, "content-type": "application/json" },
      payload: body,
    });
    expect(res.statusCode).toBe(403);
  });

  it("202 for audit_officer with a valid body", async () => {
    const jwt = token(["audit_officer"], TENANT, ACTOR);
    const res = await app.inject({
      method: "POST", url: "/v1/audit/observations",
      headers: { authorization: `Bearer ${jwt}`, "content-type": "application/json" },
      payload: body,
    });
    expect(res.statusCode).toBe(202);
    const json = res.json();
    expect(json.status).toBe("accepted");
    expect(json.id).toBeDefined();
  });
});

describe("POST /v1/audit/observations/:id/reply", () => {
  const body = { replyText: "Corrective action taken", respondedByRef: "dept:finance:head" };

  it("401 without a token", async () => {
    const res = await app.inject({ method: "POST", url: `/v1/audit/observations/${SEEDED_ID}/reply`, payload: body });
    expect(res.statusCode).toBe(401);
  });

  it("403 for a role outside AUDITEE_ROLES (employee)", async () => {
    const jwt = token(["employee"], TENANT, ACTOR);
    const res = await app.inject({
      method: "POST", url: `/v1/audit/observations/${SEEDED_ID}/reply`,
      headers: { authorization: `Bearer ${jwt}`, "content-type": "application/json" },
      payload: body,
    });
    expect(res.statusCode).toBe(403);
  });

  it("202 for dept_head", async () => {
    const jwt = token(["dept_head"], TENANT, ACTOR);
    const res = await app.inject({
      method: "POST", url: `/v1/audit/observations/${SEEDED_ID}/reply`,
      headers: { authorization: `Bearer ${jwt}`, "content-type": "application/json" },
      payload: body,
    });
    expect(res.statusCode).toBe(202);
    const json = res.json();
    expect(json.status).toBe("accepted");
  });
});

describe("POST /v1/audit/observations/:id/review", () => {
  const body = { decision: "accepted" };

  it("401 without a token", async () => {
    const res = await app.inject({ method: "POST", url: `/v1/audit/observations/${SEEDED_ID}/review`, payload: body });
    expect(res.statusCode).toBe(401);
  });

  it("403 for a role outside REVIEW_ROLES (audit_officer)", async () => {
    const jwt = token(["audit_officer"], TENANT, ACTOR);
    const res = await app.inject({
      method: "POST", url: `/v1/audit/observations/${SEEDED_ID}/review`,
      headers: { authorization: `Bearer ${jwt}`, "content-type": "application/json" },
      payload: body,
    });
    expect(res.statusCode).toBe(403);
  });

  it("202 for audit_admin", async () => {
    const jwt = token(["audit_admin"], TENANT, ACTOR);
    const res = await app.inject({
      method: "POST", url: `/v1/audit/observations/${SEEDED_ID}/review`,
      headers: { authorization: `Bearer ${jwt}`, "content-type": "application/json" },
      payload: body,
    });
    expect(res.statusCode).toBe(202);
    const json = res.json();
    expect(json.status).toBe("accepted");
  });
});

describe("POST /v1/audit/observations/:id/close", () => {
  const body = { mode: "full", closureRemarks: "Fully resolved, no outstanding paras" };

  it("401 without a token", async () => {
    const res = await app.inject({ method: "POST", url: `/v1/audit/observations/${SEEDED_ID}/close`, payload: body });
    expect(res.statusCode).toBe(401);
  });

  it("403 for a role outside REVIEW_ROLES (audit_officer)", async () => {
    const jwt = token(["audit_officer"], TENANT, ACTOR);
    const res = await app.inject({
      method: "POST", url: `/v1/audit/observations/${SEEDED_ID}/close`,
      headers: { authorization: `Bearer ${jwt}`, "content-type": "application/json" },
      payload: body,
    });
    expect(res.statusCode).toBe(403);
  });

  it("202 for audit_admin", async () => {
    const jwt = token(["audit_admin"], TENANT, ACTOR);
    const res = await app.inject({
      method: "POST", url: `/v1/audit/observations/${SEEDED_ID}/close`,
      headers: { authorization: `Bearer ${jwt}`, "content-type": "application/json" },
      payload: body,
    });
    expect(res.statusCode).toBe(202);
    const json = res.json();
    expect(json.status).toBe("accepted");
  });
});

describe("GET /v1/audit/observations", () => {
  it("401 without a token", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/audit/observations" });
    expect(res.statusCode).toBe(401);
  });

  it("403 for a role outside READER_ROLES (employee)", async () => {
    const jwt = token(["employee"], TENANT, ACTOR);
    const res = await app.inject({
      method: "GET", url: "/v1/audit/observations",
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it("200 for audit_officer, includes the seeded observation", async () => {
    const jwt = token(["audit_officer"], TENANT, ACTOR);
    const res = await app.inject({
      method: "GET", url: "/v1/audit/observations",
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    const data = Array.isArray(body) ? body : body.data ?? [];
    expect(data.some((o: { id?: string }) => o.id === SEEDED_ID)).toBe(true);
  });

  it("tenant isolation: a different tenant does not see the seeded observation", async () => {
    const jwt = token(["audit_officer"], OTHER_TENANT, ACTOR);
    const res = await app.inject({
      method: "GET", url: "/v1/audit/observations",
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    const data = Array.isArray(body) ? body : body.data ?? [];
    expect(data.some((o: { id?: string }) => o.id === SEEDED_ID)).toBe(false);
  });
});

describe("GET /v1/audit/observations/:id", () => {
  it("401 without a token", async () => {
    const res = await app.inject({ method: "GET", url: `/v1/audit/observations/${randomUUID()}` });
    expect(res.statusCode).toBe(401);
  });

  it("403 for a role outside READER_ROLES (employee)", async () => {
    const jwt = token(["employee"], TENANT, ACTOR);
    const res = await app.inject({
      method: "GET", url: `/v1/audit/observations/${randomUUID()}`,
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it("404 for a random id", async () => {
    const jwt = token(["audit_officer"], TENANT, ACTOR);
    const res = await app.inject({
      method: "GET", url: `/v1/audit/observations/${randomUUID()}`,
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(res.statusCode).toBe(404);
  });

  it("200 for the seeded observation's real id", async () => {
    const jwt = token(["audit_officer"], TENANT, ACTOR);
    const res = await app.inject({
      method: "GET", url: `/v1/audit/observations/${SEEDED_ID}`,
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    const data = body.data ?? body;
    expect(data.id).toBe(SEEDED_ID);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// GAP-AUDIT-OBSERVATIONS-07 — POST enum validation + exactly-one audit event
//
// Given: POST /v1/audit/observations with an invalid category or riskLevel;
// When: the route processes the body;
// Then: 400 VALIDATION_FAILED.
//
// Given: a POST /v1/audit/observations command driven through the full
//   consumer pipeline (observation consumer + audit consumer);
// When: the queue is drained;
// Then: exactly one audit_events row is created with target = the new id.
// ──────────────────────────────────────────────────────────────────────────────
describe("GAP-AUDIT-OBSERVATIONS-07 — POST enum validation (400 on invalid enum)", () => {
  it("400 for an invalid category value", async () => {
    const jwt = token(["audit_officer"], TENANT, ACTOR);
    const res = await app.inject({
      method: "POST", url: "/v1/audit/observations",
      headers: { authorization: `Bearer ${jwt}`, "content-type": "application/json" },
      payload: {
        obsNo: `OBS-CATENUM-${Date.now()}`, auditeeRef: "dept:finance",
        finding: "category enum test", category: "invalid_category",
        riskLevel: "medium", amountInvolvedMinor: "0",
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it("400 for an invalid riskLevel value", async () => {
    const jwt = token(["audit_officer"], TENANT, ACTOR);
    const res = await app.inject({
      method: "POST", url: "/v1/audit/observations",
      headers: { authorization: `Bearer ${jwt}`, "content-type": "application/json" },
      payload: {
        obsNo: `OBS-RLENUM-${Date.now()}`, auditeeRef: "dept:finance",
        finding: "riskLevel enum test", category: "compliance",
        riskLevel: "extreme", amountInvolvedMinor: "0",
      },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("GAP-AUDIT-OBSERVATIONS-07 — POST writes exactly one audit event per mutation", () => {
  const OBS07_TENANT = randomUUID();
  const OBS07_ACTOR  = randomUUID();

  let MemQ: typeof import("@civitasone/queue")["MemoryQueue"];
  let withTenantCons: typeof import("@civitasone/db")["withTenantConsumer"];
  let auditEvts: typeof import("../src/modules/events/schema.js")["auditEvents"];
  let dbInst: typeof import("../src/shared/db.js")["db"];
  let regObs: typeof import("../src/modules/observation/consumer.js")["registerObservationConsumers"];
  let regAudit: typeof import("../src/modules/events/consumer.js")["registerAuditConsumers"];
  let runWT: typeof import("@civitasone/db")["runWithTenant"];

  function wireTenantQ(q: import("@civitasone/queue").Queue): import("@civitasone/queue").Queue {
    const raw = q.subscribe.bind(q);
    q.subscribe = ((topic: string, handler: import("@civitasone/queue").Handler) =>
      raw(topic, withTenantCons(handler) as import("@civitasone/queue").Handler)) as typeof q.subscribe;
    return q;
  }

  beforeAll(async () => {
    ({ MemoryQueue: MemQ } = await import("@civitasone/queue"));
    ({ withTenantConsumer: withTenantCons } = await import("@civitasone/db"));
    ({ auditEvents: auditEvts } = await import("../src/modules/events/schema.js"));
    ({ db: dbInst } = await import("../src/shared/db.js"));
    ({ registerObservationConsumers: regObs } = await import("../src/modules/observation/consumer.js"));
    ({ registerAuditConsumers: regAudit } = await import("../src/modules/events/consumer.js"));
    ({ runWithTenant: runWT } = await import("@civitasone/db"));
  });

  it("exactly one audit event is written when an observation is created", async () => {
    const obsId = randomUUID();
    const q = wireTenantQ(new MemQ());
    regObs(q);
    regAudit(q);
    await q.start();

    await q.publish("audit.observation.create", {
      messageId: obsId, type: "audit.observation.create",
      tenantId: OBS07_TENANT, actorId: OBS07_ACTOR,
      correlationId: randomUUID(), schemaVersion: "1.0",
      payload: {
        id: obsId, tenantId: OBS07_TENANT,
        obsNo: `OBS-AUDEVT-${Date.now()}`, auditeeRef: "dept:finance",
        finding: "Audit event write test", category: "compliance",
        riskLevel: "medium", amountInvolvedMinor: "5000",
      },
    });
    await new Promise<void>((r) => setTimeout(r, 700));
    // Flush outbox so registerAuditConsumers picks up the enqueued audit events.
    await relayOnce(dbInst as never, q, 100, "audit-service");
    await new Promise<void>((r) => setTimeout(r, 300));
    await q.stop();

    const { eq: eqFn } = await import("drizzle-orm");
    const events = await runWT(OBS07_TENANT, () =>
      dbInst.transaction((tx) =>
        tx.select().from(auditEvts).where(eqFn(auditEvts.tenantId, OBS07_TENANT)).limit(20),
      ),
    );
    const createEvents = events.filter(
      (r) =>
        r.target === obsId &&
        typeof r.payload === "object" &&
        r.payload !== null &&
        (r.payload as Record<string, unknown>)["action"] === "create",
    );
    expect(createEvents).toHaveLength(1);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// GAP-AUDIT-OBSERVATIONS-DETAIL-07
//   — draft-para role gate
//   — exactly-one audit event per reply mutation
//   — status-transition enforcement (reply on non-open obs stays unchanged)
// ──────────────────────────────────────────────────────────────────────────────
describe("GAP-AUDIT-OBSERVATIONS-DETAIL-07 — POST /:id/draft-para role gate", () => {
  const dpBody = { paraNo: "PARA-GATE-01", deptRef: "dept:finance", body: "Para body for role gate test" };

  it("401 without a bearer token", async () => {
    const res = await app.inject({
      method: "POST", url: `/v1/audit/observations/${SEEDED_ID}/draft-para`,
      payload: dpBody,
    });
    expect(res.statusCode).toBe(401);
  });

  it("403 for employee (outside AUDIT_ROLES)", async () => {
    const jwt = token(["employee"], TENANT, ACTOR);
    const res = await app.inject({
      method: "POST", url: `/v1/audit/observations/${SEEDED_ID}/draft-para`,
      headers: { authorization: `Bearer ${jwt}`, "content-type": "application/json" },
      payload: dpBody,
    });
    expect(res.statusCode).toBe(403);
  });

  it("403 for dept_head (AUDITEE_ROLES but not AUDIT_ROLES)", async () => {
    const jwt = token(["dept_head"], TENANT, ACTOR);
    const res = await app.inject({
      method: "POST", url: `/v1/audit/observations/${SEEDED_ID}/draft-para`,
      headers: { authorization: `Bearer ${jwt}`, "content-type": "application/json" },
      payload: dpBody,
    });
    expect(res.statusCode).toBe(403);
  });

  it("202 accepted for audit_officer", async () => {
    const jwt = token(["audit_officer"], TENANT, ACTOR);
    const res = await app.inject({
      method: "POST", url: `/v1/audit/observations/${SEEDED_ID}/draft-para`,
      headers: { authorization: `Bearer ${jwt}`, "content-type": "application/json" },
      payload: dpBody,
    });
    expect(res.statusCode).toBe(202);
    expect(res.json().status).toBe("accepted");
  });
});

describe("GAP-AUDIT-OBSERVATIONS-DETAIL-07 — reply audit event + status-transition enforcement", () => {
  const OD07_TENANT = randomUUID();
  const OD07_ACTOR  = randomUUID();

  let MemQ2: typeof import("@civitasone/queue")["MemoryQueue"];
  let withTenantCons2: typeof import("@civitasone/db")["withTenantConsumer"];
  let auditEvts2: typeof import("../src/modules/events/schema.js")["auditEvents"];
  let dbInst2: typeof import("../src/shared/db.js")["db"];
  let obsSchema: typeof import("../src/modules/observation/schema.js")["auditObservations"];
  let regObs2: typeof import("../src/modules/observation/consumer.js")["registerObservationConsumers"];
  let regAudit2: typeof import("../src/modules/events/consumer.js")["registerAuditConsumers"];
  let runWT2: typeof import("@civitasone/db")["runWithTenant"];

  function wireTenantQ2(q: import("@civitasone/queue").Queue): import("@civitasone/queue").Queue {
    const raw = q.subscribe.bind(q);
    q.subscribe = ((topic: string, handler: import("@civitasone/queue").Handler) =>
      raw(topic, withTenantCons2(handler) as import("@civitasone/queue").Handler)) as typeof q.subscribe;
    return q;
  }

  beforeAll(async () => {
    ({ MemoryQueue: MemQ2 } = await import("@civitasone/queue"));
    ({ withTenantConsumer: withTenantCons2 } = await import("@civitasone/db"));
    ({ auditEvents: auditEvts2 } = await import("../src/modules/events/schema.js"));
    ({ db: dbInst2 } = await import("../src/shared/db.js"));
    ({ auditObservations: obsSchema } = await import("../src/modules/observation/schema.js"));
    ({ registerObservationConsumers: regObs2 } = await import("../src/modules/observation/consumer.js"));
    ({ registerAuditConsumers: regAudit2 } = await import("../src/modules/events/consumer.js"));
    ({ runWithTenant: runWT2 } = await import("@civitasone/db"));
  });

  it("a reply command writes exactly one audit event with action='reply'", async () => {
    const obsId = randomUUID();
    const q = wireTenantQ2(new MemQ2());
    regObs2(q);
    regAudit2(q);
    await q.start();

    // Create the observation first (status → "open")
    await q.publish("audit.observation.create", {
      messageId: randomUUID(), type: "audit.observation.create",
      tenantId: OD07_TENANT, actorId: OD07_ACTOR,
      correlationId: randomUUID(), schemaVersion: "1.0",
      payload: {
        id: obsId, tenantId: OD07_TENANT,
        obsNo: `OBS-RPLYAUDEVT-${Date.now()}`, auditeeRef: "dept:it",
        finding: "Reply audit event test", amountInvolvedMinor: "0",
      },
    });
    await new Promise<void>((r) => setTimeout(r, 600));

    // Submit a valid reply (status "open" → "replied")
    await q.publish("audit.observation.reply", {
      messageId: randomUUID(), type: "audit.observation.reply",
      tenantId: OD07_TENANT, actorId: OD07_ACTOR,
      correlationId: randomUUID(), schemaVersion: "1.0",
      payload: {
        id: randomUUID(), observationId: obsId, tenantId: OD07_TENANT,
        replyText: "Corrective action taken", respondedByRef: "dept:it:head",
      },
    });
    await new Promise<void>((r) => setTimeout(r, 600));
    await q.stop();

    const { eq: eqFn } = await import("drizzle-orm");
    const events = await runWT2(OD07_TENANT, () =>
      dbInst2.transaction((tx) =>
        tx.select().from(auditEvts2).where(eqFn(auditEvts2.tenantId, OD07_TENANT)).limit(20),
      ),
    );
    const replyEvents = events.filter(
      (r) =>
        r.target === obsId &&
        typeof r.payload === "object" &&
        r.payload !== null &&
        (r.payload as Record<string, unknown>)["action"] === "reply",
    );
    expect(replyEvents).toHaveLength(1);
  });

  it("status-transition enforcement: replying on a compliance_pending obs leaves status unchanged", async () => {
    const obsId2 = randomUUID();
    const q = wireTenantQ2(new MemQ2());
    regObs2(q);
    regAudit2(q);
    await q.start();

    // Create observation (status → "open")
    await q.publish("audit.observation.create", {
      messageId: randomUUID(), type: "audit.observation.create",
      tenantId: OD07_TENANT, actorId: OD07_ACTOR,
      correlationId: randomUUID(), schemaVersion: "1.0",
      payload: {
        id: obsId2, tenantId: OD07_TENANT,
        obsNo: `OBS-TRANS-${Date.now()}`, auditeeRef: "dept:hr",
        finding: "Transition enforcement test", amountInvolvedMinor: "0",
      },
    });
    await new Promise<void>((r) => setTimeout(r, 500));

    // Force status to compliance_pending (cannot receive a reply)
    const { eq: eqFn } = await import("drizzle-orm");
    await runWT2(OD07_TENANT, () =>
      dbInst2.transaction((tx) =>
        tx.update(obsSchema).set({ status: "compliance_pending" }).where(eqFn(obsSchema.id, obsId2)),
      ),
    );

    // Attempt invalid reply — consumer throws, status must stay "compliance_pending"
    await q.publish("audit.observation.reply", {
      messageId: randomUUID(), type: "audit.observation.reply",
      tenantId: OD07_TENANT, actorId: OD07_ACTOR,
      correlationId: randomUUID(), schemaVersion: "1.0",
      payload: {
        id: randomUUID(), observationId: obsId2, tenantId: OD07_TENANT,
        replyText: "Should not succeed", respondedByRef: "dept:hr:head",
      },
    });
    await new Promise<void>((r) => setTimeout(r, 500));
    await q.stop();

    const rows = await runWT2(OD07_TENANT, () =>
      dbInst2.transaction((tx) =>
        tx.select().from(obsSchema).where(eqFn(obsSchema.id, obsId2)).limit(1),
      ),
    );
    // Status transition was enforced — still "compliance_pending"
    expect(rows[0]?.status).toBe("compliance_pending");
  });
});
