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
