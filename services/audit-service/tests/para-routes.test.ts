/**
 * audit-service para HTTP route layer tests
 *
 * Covers routes.ts / commands.ts / queries.ts (previously near-zero coverage):
 *  - POST /v1/audit/paras/:id/issue          — 401 / 403 / 202
 *  - POST /v1/audit/paras/:id/response       — 401 / 403 / 202 (dept_head + audit_officer) / 400
 *  - PATCH /v1/audit/paras/:id/settle        — 401 / 403 / 202 (with body + empty body)
 *  - PATCH /v1/audit/paras/:id/pending_recovery — 401 / 403 / 202
 *  - PATCH /v1/audit/paras/:id/close         — 401 / 403 / 202
 *  - GET /v1/audit/paras                     — 401 / 403 / 200 (reader roles) / tenant isolation /
 *                                               status + deptRef filters / 400 on invalid status
 *
 * Mirrors the JWT + app.inject pattern from tests/rls-isolation.test.ts and the
 * runWithTenant + db.transaction seeding/cleanup pattern from tests/para.test.ts.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { runWithTenant } from "@civitasone/db";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { auditParas } from "../src/modules/para/schema.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
function token(roles: string[], tenantId: string, actorId: string) {
  return signToken({ sub: actorId, tid: tenantId, roles, sid: "sess-1" }, SECRET, 3600);
}

const ACTOR    = "00000000-aaaa-4000-8000-0000000000b1";
const TENANT   = "11111111-aaaa-4000-8000-0000000000b1";
const TENANT_2 = "11111111-aaaa-4000-8000-0000000000b2";
const PARA_1   = "22222222-bbbb-4000-8000-0000000000b1";
const PARA_2   = "22222222-bbbb-4000-8000-0000000000b2";

async function wipe() {
  await runWithTenant(TENANT, () => db.transaction((tx) => tx.delete(auditParas).where(eq(auditParas.tenantId, TENANT))));
  await runWithTenant(TENANT_2, () => db.transaction((tx) => tx.delete(auditParas).where(eq(auditParas.tenantId, TENANT_2))));
}

async function seedPara(id: string, tenantId: string, overrides: Partial<{ status: string; deptRef: string; paraNo: string }> = {}): Promise<void> {
  await runWithTenant(tenantId, () => db.transaction((tx) => tx.insert(auditParas).values({
    id, tenantId, paraNo: overrides.paraNo ?? "PARA-2026-ROUTE-001", deptRef: overrides.deptRef ?? "dept:finance",
    body: "Irregular payment detected", category: "financial", amountInvolvedMinor: 500000n,
    status: overrides.status ?? "draft", createdBy: ACTOR, updatedBy: ACTOR,
  })));
}

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp();
  await wipe();
});

afterAll(async () => {
  await wipe();
  await app.close();
  await sqlClient.end();
});

describe("POST /v1/audit/paras/:id/issue", () => {
  it("401 when no bearer token is supplied", async () => {
    const res = await app.inject({ method: "POST", url: `/v1/audit/paras/${randomUUID()}/issue` });
    expect(res.statusCode).toBe(401);
  });

  it("403 for wrong role (employee)", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/audit/paras/${randomUUID()}/issue`,
      headers: { authorization: `Bearer ${token(["employee"], TENANT, ACTOR)}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it("202 for audit_officer — publishes a command, no DB write needed", async () => {
    const paraId = randomUUID();
    const res = await app.inject({
      method: "POST",
      url: `/v1/audit/paras/${paraId}/issue`,
      headers: { authorization: `Bearer ${token(["audit_officer"], TENANT, ACTOR)}` },
    });
    expect(res.statusCode).toBe(202);
    const body = res.json();
    expect(body.id).toBe(paraId);
    expect(body.status).toBe("accepted");
    expect(body.correlationId).toBeDefined();
  });
});

describe("POST /v1/audit/paras/:id/response", () => {
  const validBody = { responseBody: "Recovery action initiated", respondedByRef: "dept:finance:head" };

  it("401 when no bearer token is supplied", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/audit/paras/${randomUUID()}/response`,
      payload: validBody,
    });
    expect(res.statusCode).toBe(401);
  });

  it("403 for role outside DEPT_ROLES (finance_admin)", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/audit/paras/${randomUUID()}/response`,
      headers: { authorization: `Bearer ${token(["finance_admin"], TENANT, ACTOR)}`, "content-type": "application/json" },
      payload: validBody,
    });
    expect(res.statusCode).toBe(403);
  });

  it("202 for dept_head", async () => {
    const paraId = randomUUID();
    const res = await app.inject({
      method: "POST",
      url: `/v1/audit/paras/${paraId}/response`,
      headers: { authorization: `Bearer ${token(["dept_head"], TENANT, ACTOR)}`, "content-type": "application/json" },
      payload: validBody,
    });
    expect(res.statusCode).toBe(202);
    const body = res.json();
    expect(body.id).toBe(paraId);
    expect(body.status).toBe("accepted");
  });

  it("202 for audit_officer", async () => {
    const paraId = randomUUID();
    const res = await app.inject({
      method: "POST",
      url: `/v1/audit/paras/${paraId}/response`,
      headers: { authorization: `Bearer ${token(["audit_officer"], TENANT, ACTOR)}`, "content-type": "application/json" },
      payload: validBody,
    });
    expect(res.statusCode).toBe(202);
    const body = res.json();
    expect(body.id).toBe(paraId);
    expect(body.status).toBe("accepted");
  });

  it("400 when required fields (responseBody/respondedByRef) are missing", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/audit/paras/${randomUUID()}/response`,
      headers: { authorization: `Bearer ${token(["audit_officer"], TENANT, ACTOR)}`, "content-type": "application/json" },
      payload: {},
    });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.code).toBe("VALIDATION_FAILED");
  });
});

describe("PATCH /v1/audit/paras/:id/settle", () => {
  it("401 when no bearer token is supplied", async () => {
    const res = await app.inject({ method: "PATCH", url: `/v1/audit/paras/${randomUUID()}/settle` });
    expect(res.statusCode).toBe(401);
  });

  it("403 for wrong role (employee)", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/audit/paras/${randomUUID()}/settle`,
      headers: { authorization: `Bearer ${token(["employee"], TENANT, ACTOR)}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it("202 for audit_officer with an optional body", async () => {
    const paraId = randomUUID();
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/audit/paras/${paraId}/settle`,
      headers: { authorization: `Bearer ${token(["audit_officer"], TENANT, ACTOR)}`, "content-type": "application/json" },
      payload: { reason: "amount recovered" },
    });
    expect(res.statusCode).toBe(202);
    const body = res.json();
    expect(body.id).toBe(paraId);
    expect(body.status).toBe("accepted");
  });

  it("202 for audit_officer with an empty body (body is optional/defaults)", async () => {
    const paraId = randomUUID();
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/audit/paras/${paraId}/settle`,
      headers: { authorization: `Bearer ${token(["audit_officer"], TENANT, ACTOR)}` },
    });
    expect(res.statusCode).toBe(202);
    const body = res.json();
    expect(body.id).toBe(paraId);
    expect(body.status).toBe("accepted");
  });
});

describe("PATCH /v1/audit/paras/:id/pending_recovery", () => {
  it("401 when no bearer token is supplied", async () => {
    const res = await app.inject({ method: "PATCH", url: `/v1/audit/paras/${randomUUID()}/pending_recovery` });
    expect(res.statusCode).toBe(401);
  });

  it("403 for wrong role (employee)", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/audit/paras/${randomUUID()}/pending_recovery`,
      headers: { authorization: `Bearer ${token(["employee"], TENANT, ACTOR)}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it("202 for audit_officer", async () => {
    const paraId = randomUUID();
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/audit/paras/${paraId}/pending_recovery`,
      headers: { authorization: `Bearer ${token(["audit_officer"], TENANT, ACTOR)}`, "content-type": "application/json" },
      payload: { reason: "recovery in progress", dueDate: "2026-12-31" },
    });
    expect(res.statusCode).toBe(202);
    const body = res.json();
    expect(body.id).toBe(paraId);
    expect(body.status).toBe("accepted");
  });
});

describe("PATCH /v1/audit/paras/:id/close", () => {
  it("401 when no bearer token is supplied", async () => {
    const res = await app.inject({ method: "PATCH", url: `/v1/audit/paras/${randomUUID()}/close` });
    expect(res.statusCode).toBe(401);
  });

  it("403 for wrong role (employee)", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/audit/paras/${randomUUID()}/close`,
      headers: { authorization: `Bearer ${token(["employee"], TENANT, ACTOR)}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it("202 for audit_officer", async () => {
    const paraId = randomUUID();
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/audit/paras/${paraId}/close`,
      headers: { authorization: `Bearer ${token(["audit_officer"], TENANT, ACTOR)}`, "content-type": "application/json" },
      payload: { reason: "fully resolved" },
    });
    expect(res.statusCode).toBe(202);
    const body = res.json();
    expect(body.id).toBe(paraId);
    expect(body.status).toBe("accepted");
  });
});

describe("GET /v1/audit/paras", () => {
  beforeAll(async () => {
    await wipe();
    await seedPara(PARA_1, TENANT, { status: "draft", deptRef: "dept:finance", paraNo: "PARA-2026-ROUTE-A" });
    await seedPara(PARA_2, TENANT, { status: "issued", deptRef: "dept:hr", paraNo: "PARA-2026-ROUTE-B" });
  });
  afterAll(async () => { await wipe(); });

  it("401 when no bearer token is supplied", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/audit/paras" });
    expect(res.statusCode).toBe(401);
  });

  it("403 for role outside READER_ROLES (employee)", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/audit/paras",
      headers: { authorization: `Bearer ${token(["employee"], TENANT, ACTOR)}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it("200 for audit_officer and contains the seeded row", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/audit/paras",
      headers: { authorization: `Bearer ${token(["audit_officer"], TENANT, ACTOR)}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body.items)).toBe(true);
    expect(body.items.some((p: { id?: string }) => p.id === PARA_1)).toBe(true);
  });

  it("200 for finance_admin", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/audit/paras",
      headers: { authorization: `Bearer ${token(["finance_admin"], TENANT, ACTOR)}` },
    });
    expect(res.statusCode).toBe(200);
  });

  it("200 for dept_head", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/audit/paras",
      headers: { authorization: `Bearer ${token(["dept_head"], TENANT, ACTOR)}` },
    });
    expect(res.statusCode).toBe(200);
  });

  it("a different tenant's GET does not see this tenant's seeded row (tenant isolation)", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/audit/paras",
      headers: { authorization: `Bearer ${token(["audit_officer"], TENANT_2, ACTOR)}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    const leaked = body.items.filter((p: { id?: string }) => p.id === PARA_1 || p.id === PARA_2);
    expect(leaked).toHaveLength(0);
  });

  it("?status= filters the results", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/audit/paras?status=issued",
      headers: { authorization: `Bearer ${token(["audit_officer"], TENANT, ACTOR)}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.items.some((p: { id?: string }) => p.id === PARA_2)).toBe(true);
    expect(body.items.some((p: { id?: string }) => p.id === PARA_1)).toBe(false);
  });

  it("?deptRef= filters the results", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/audit/paras?deptRef=dept:hr",
      headers: { authorization: `Bearer ${token(["audit_officer"], TENANT, ACTOR)}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.items.some((p: { id?: string }) => p.id === PARA_2)).toBe(true);
    expect(body.items.some((p: { id?: string }) => p.id === PARA_1)).toBe(false);
  });

  it("400 for an invalid status value", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/audit/paras?status=invalid_status",
      headers: { authorization: `Bearer ${token(["audit_officer"], TENANT, ACTOR)}` },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.code).toBe("VALIDATION_FAILED");
  });
});
