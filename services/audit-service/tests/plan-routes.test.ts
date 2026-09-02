/**
 * Plan HTTP route/command layer coverage — audit-service
 *
 * Existing tests/plan.test.ts covers the consumer/domain layer well but has
 * only a thin slice of route coverage (401/403/202/400 for POST /v1/audit/plans
 * plus a single 404 check). This file fills the route/command-layer gap
 * (plan/commands.ts is at 1.78% lines) across every plan route:
 *  - POST /v1/audit/plans            (401/403/202/400)
 *  - POST /v1/audit/plans/:id/items  (401/403/202)
 *  - PATCH /v1/audit/plans/:id/start (401/403/202)
 *  - GET /v1/audit/plans/:id         (401/403/404/200 for a seeded plan)
 *  - GET /v1/audit/plans (list)      (401/403/200 own-tenant + isolation)
 *
 * Test-harness patterns follow tests/plan.test.ts (runWithTenant + db.transaction
 * seeding/cleanup) and tests/rls-isolation.test.ts (app.inject + signToken).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { runWithTenant } from "@civitasone/db";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { auditPlans } from "../src/modules/plan/schema.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
function token(roles: string[], tenantId: string, actorId: string) {
  return signToken({ sub: actorId, tid: tenantId, roles, sid: "sess-1" }, SECRET, 3600);
}

const TENANT = randomUUID();
const OTHER_TENANT = randomUUID();
const ACTOR = randomUUID();
const SEEDED_PLAN = randomUUID();

// Test-harness fix (mirrors tests/plan.test.ts): bare db.select()/db.insert()
// outside db.transaction() (or without an active runWithTenant scope) run
// with no RLS GUC set. Wrap all direct DB access in
// runWithTenant(TENANT, () => db.transaction(...)).
async function seedPlan(): Promise<void> {
  await runWithTenant(TENANT, () => db.transaction((tx) => tx.insert(auditPlans).values({
    id: SEEDED_PLAN,
    tenantId: TENANT,
    planNo: "PLAN-ROUTES-SEED-1",
    title: "Seeded Plan For Route Tests",
    area: "Finance Department",
    periodFrom: "2026-04-01",
    periodTo: "2027-03-31",
    riskLevel: "medium",
    status: "draft",
    createdBy: ACTOR,
    updatedBy: ACTOR,
  })));
}

// plan.audit_plans is a case-of-record table: migration 0027 added a BEFORE
// DELETE OR TRUNCATE trigger that unconditionally rejects both, so this is
// now a no-op. TENANT/SEEDED_PLAN above are already randomUUID()-scoped per
// test run, so leftover rows across runs are harmless and never collide.
async function wipe(): Promise<void> {
  /* no-op: see comment above */
}

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp();
  await wipe();
  await seedPlan();
});

afterAll(async () => {
  await wipe();
  await app.close();
  await sqlClient.end();
});

describe("POST /v1/audit/plans", () => {
  it("401 when no bearer token is supplied", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/audit/plans",
      payload: {
        planNo: "PLAN-NOAUTH", title: "No Auth", area: "Finance",
        periodFrom: "2026-04-01", periodTo: "2027-03-31",
      },
    });
    expect(res.statusCode).toBe(401);
  });

  it("403 for a role without write access (employee)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/audit/plans",
      headers: { authorization: `Bearer ${token(["employee"], TENANT, ACTOR)}`, "content-type": "application/json" },
      payload: {
        planNo: "PLAN-WRONGROLE", title: "Wrong Role", area: "Finance",
        periodFrom: "2026-04-01", periodTo: "2027-03-31",
      },
    });
    expect(res.statusCode).toBe(403);
  });

  it("202 for audit_officer with a valid body", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/audit/plans",
      headers: { authorization: `Bearer ${token(["audit_officer"], TENANT, ACTOR)}`, "content-type": "application/json" },
      payload: {
        planNo: `PLAN-VALID-${Date.now()}`, title: "Valid Plan", area: "Finance Department",
        periodFrom: "2026-04-01", periodTo: "2027-03-31",
      },
    });
    expect(res.statusCode).toBe(202);
    const body = res.json();
    expect(body.status).toBe("accepted");
    expect(typeof body.id).toBe("string");
    expect(body.correlationId).toBeDefined();
  });

  it("400 when a required field (title) is missing", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/audit/plans",
      headers: { authorization: `Bearer ${token(["audit_officer"], TENANT, ACTOR)}`, "content-type": "application/json" },
      payload: {
        planNo: "PLAN-INVALID", area: "Finance Department",
        periodFrom: "2026-04-01", periodTo: "2027-03-31",
      },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.code).toBe("VALIDATION_FAILED");
  });
});

describe("POST /v1/audit/plans/:id/items", () => {
  it("401 when no bearer token is supplied", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/audit/plans/${SEEDED_PLAN}/items`,
      payload: { deptRef: "dept:finance", scheduledFrom: "2026-05-01", scheduledTo: "2026-05-15" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("403 for a role without write access (employee)", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/audit/plans/${SEEDED_PLAN}/items`,
      headers: { authorization: `Bearer ${token(["employee"], TENANT, ACTOR)}`, "content-type": "application/json" },
      payload: { deptRef: "dept:finance", scheduledFrom: "2026-05-01", scheduledTo: "2026-05-15" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("202 for audit_officer with a valid body", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/audit/plans/${SEEDED_PLAN}/items`,
      headers: { authorization: `Bearer ${token(["audit_officer"], TENANT, ACTOR)}`, "content-type": "application/json" },
      payload: { deptRef: "dept:finance", scheduledFrom: "2026-05-01", scheduledTo: "2026-05-15" },
    });
    expect(res.statusCode).toBe(202);
    const body = res.json();
    expect(body.status).toBe("accepted");
    expect(typeof body.id).toBe("string");
  });
});

describe("PATCH /v1/audit/plans/:id/start", () => {
  it("401 when no bearer token is supplied", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/audit/plans/${SEEDED_PLAN}/start`,
    });
    expect(res.statusCode).toBe(401);
  });

  it("403 for a role without write access (employee)", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/audit/plans/${SEEDED_PLAN}/start`,
      headers: { authorization: `Bearer ${token(["employee"], TENANT, ACTOR)}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it("202 for audit_officer", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/audit/plans/${SEEDED_PLAN}/start`,
      headers: { authorization: `Bearer ${token(["audit_officer"], TENANT, ACTOR)}` },
    });
    expect(res.statusCode).toBe(202);
    const body = res.json();
    expect(body.status).toBe("accepted");
    expect(body.id).toBe(SEEDED_PLAN);
  });
});

describe("GET /v1/audit/plans/:id", () => {
  it("401 when no bearer token is supplied", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/audit/plans/${SEEDED_PLAN}`,
    });
    expect(res.statusCode).toBe(401);
  });

  it("403 for a role without read access (employee)", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/audit/plans/${SEEDED_PLAN}`,
      headers: { authorization: `Bearer ${token(["employee"], TENANT, ACTOR)}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it("404 for a random (nonexistent) id", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/audit/plans/${randomUUID()}`,
      headers: { authorization: `Bearer ${token(["audit_officer"], TENANT, ACTOR)}` },
    });
    expect(res.statusCode).toBe(404);
  });

  it("200 for the seeded plan", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/audit/plans/${SEEDED_PLAN}`,
      headers: { authorization: `Bearer ${token(["audit_officer"], TENANT, ACTOR)}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.id).toBe(SEEDED_PLAN);
    expect(body.planNo).toBe("PLAN-ROUTES-SEED-1");
    expect(body.tenantId).toBe(TENANT);
  });

  it("200 for a reader-only role (finance_admin)", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/audit/plans/${SEEDED_PLAN}`,
      headers: { authorization: `Bearer ${token(["finance_admin"], TENANT, ACTOR)}` },
    });
    expect(res.statusCode).toBe(200);
  });
});

describe("GET /v1/audit/plans (list)", () => {
  it("401 when no bearer token is supplied", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/audit/plans" });
    expect(res.statusCode).toBe(401);
  });

  it("403 for a role without read access (employee)", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/audit/plans",
      headers: { authorization: `Bearer ${token(["employee"], TENANT, ACTOR)}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it("200 and returns the seeded plan for its own tenant", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/audit/plans",
      headers: { authorization: `Bearer ${token(["audit_officer"], TENANT, ACTOR)}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    const data = Array.isArray(body) ? body : body.data ?? [];
    expect(Array.isArray(data)).toBe(true);
    expect(data.some((p: { id?: string }) => p.id === SEEDED_PLAN)).toBe(true);
  });

  it("does NOT return the seeded plan for a different tenant (isolation)", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/audit/plans",
      headers: { authorization: `Bearer ${token(["audit_officer"], OTHER_TENANT, ACTOR)}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    const data = Array.isArray(body) ? body : body.data ?? [];
    expect(data.some((p: { id?: string }) => p.id === SEEDED_PLAN)).toBe(false);
  });
});
