/**
 * audit-service dashboard route tests
 *
 * Covers GET /v1/audit/dashboard:
 * - 401 (no token), 403 (wrong role), 200 for each allowed role.
 * - DB-backed: seeded open auditPara + auditRisk rows are reflected in the
 *   aggregate counts for a fresh, isolated tenant.
 *
 * Seeding follows the established pattern from tests/para.test.ts: bare
 * db.insert()/db.delete() calls run outside any tenant GUC and are rejected
 * by FORCE ROW LEVEL SECURITY, so all direct DB access here is wrapped in
 * runWithTenant(TENANT, () => db.transaction((tx) => ...)).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, and } from "drizzle-orm";
import { runWithTenant } from "@civitasone/db";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { auditObservations } from "../src/modules/observation/schema.js";
import { auditRisks } from "../src/modules/risk/schema.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";

function token(roles: string[], tenantId: string, actorId: string) {
  return signToken({ sub: actorId, tid: tenantId, roles, sid: "sess-1" }, SECRET, 3600);
}

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp();
});

afterAll(async () => {
  await app.close();
  await sqlClient.end();
});

describe("GET /v1/audit/dashboard — auth & roles", () => {
  const TENANT = randomUUID();
  const ACTOR = randomUUID();

  it("401 without a token", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/audit/dashboard" });
    expect(res.statusCode).toBe(401);
  });

  it("403 for a role without dashboard access (employee)", async () => {
    const jwt = token(["employee"], TENANT, ACTOR);
    const res = await app.inject({
      method: "GET",
      url: "/v1/audit/dashboard",
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it.each(["audit_officer", "audit_admin", "super_admin", "cag_officer"])(
    "200 for role %s",
    async (role) => {
      const jwt = token([role], TENANT, ACTOR);
      const res = await app.inject({
        method: "GET",
        url: "/v1/audit/dashboard",
        headers: { authorization: `Bearer ${jwt}` },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      const data = body.data ?? body;
      expect(data).toHaveProperty("openObservations");
      expect(data).toHaveProperty("riskRegisterItems");
    },
  );
});

describe("GET /v1/audit/dashboard — aggregate counts (DB-backed)", () => {
  const TENANT = randomUUID();
  const ACTOR = randomUUID();
  const OBSERVATION_ID = randomUUID();
  const RISK_ID = randomUUID();

  beforeAll(async () => {
    // NOTE: openObservations is backed by observation.audit_observations
    // (status defaults to/allows "open"), not para.audit_paras — the
    // audit_paras_status_check CHECK constraint (migration 0016) does not
    // permit status "open" for that table at all.
    await runWithTenant(TENANT, () => db.transaction((tx) => tx.insert(auditObservations).values({
      id: OBSERVATION_ID, tenantId: TENANT, obsNo: `OBS-DASH-${Date.now()}`, auditeeRef: "dept:finance",
      finding: "Dashboard coverage test observation", category: "financial", riskLevel: "medium",
      amountInvolvedMinor: 10000n, status: "open", createdBy: ACTOR, updatedBy: ACTOR,
    })));

    await runWithTenant(TENANT, () => db.transaction((tx) => tx.insert(auditRisks).values({
      id: RISK_ID, tenantId: TENANT, riskCode: `RISK-DASH-${Date.now()}`, title: "Dashboard coverage test risk",
      category: "operational", likelihood: "possible", impact: "moderate", riskScore: 12,
      mitigationStatus: "not_started", status: "open", createdBy: ACTOR, updatedBy: ACTOR,
    })));
  });

  afterAll(async () => {
    // auditRisks are ordinary mutable rows — safe to clean up.
    try {
      await runWithTenant(TENANT, () => db.transaction((tx) => tx.delete(auditRisks).where(eq(auditRisks.id, RISK_ID))));
    } catch { /* noop */ }

    // auditObservations may be subject to a DELETE-restriction trigger
    // (append-only style audit trail) — best-effort cleanup, tolerate failure.
    try {
      await runWithTenant(TENANT, () => db.transaction((tx) => tx.delete(auditObservations).where(eq(auditObservations.id, OBSERVATION_ID))));
    } catch { /* noop */ }
  });

  it("seeded open observation is counted directly via the query layer's filter", async () => {
    const rows = await runWithTenant(TENANT, () => db.transaction((tx) => tx
      .select()
      .from(auditObservations)
      .where(and(eq(auditObservations.tenantId, TENANT), eq(auditObservations.status, "open")))));
    expect(rows.length).toBeGreaterThanOrEqual(1);
  });

  it("GET /v1/audit/dashboard reflects the seeded open observation and risk for this tenant", async () => {
    const jwt = token(["audit_officer"], TENANT, ACTOR);
    const res = await app.inject({
      method: "GET",
      url: "/v1/audit/dashboard",
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    const data = body.data ?? body;
    expect(data.openObservations).toBeGreaterThanOrEqual(1);
    expect(data.riskRegisterItems).toBeGreaterThanOrEqual(1);
  });
});
