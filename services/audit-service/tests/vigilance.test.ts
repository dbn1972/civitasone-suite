/**
 * Vigilance module route + tenant-isolation tests — audit-service.
 *
 * Covers GET /v1/audit/vigilance:
 *  - 401 when no bearer token is supplied
 *  - 403 when the caller's role isn't one of the vigilance reader roles
 *  - 200 for each reader role (audit_officer, audit_admin, super_admin, vigilance_officer)
 *  - tenant isolation: a case seeded for tenant A is visible to tenant A and
 *    invisible to tenant B (same roles, different tenant).
 *
 * Seeding follows the pattern established in tests/para.test.ts: bare
 * db.insert()/db.select()/db.delete() run with no RLS GUC set and are
 * rejected by FORCE RLS on vigilanceCases. All direct DB access here is
 * wrapped in runWithTenant(TENANT, () => db.transaction(...)) so the tenant
 * GUC is present before the query runs.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { runWithTenant } from "@civitasone/db";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { vigilanceCases } from "../src/modules/vigilance/schema.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";

function token(roles: string[], tenantId: string, actorId: string) {
  return signToken({ sub: actorId, tid: tenantId, roles, sid: "sess-1" }, SECRET, 3600);
}

const TENANT_A = randomUUID();
const TENANT_B = randomUUID();
const ACTOR_A = randomUUID();
const ACTOR_B = randomUUID();
const CASE_A = randomUUID();

const READER_ROLES = ["audit_officer", "audit_admin", "super_admin", "vigilance_officer"];

let app: FastifyInstance;

async function seedCaseForTenantA(): Promise<void> {
  await runWithTenant(TENANT_A, () => db.transaction((tx) => tx.insert(vigilanceCases).values({
    id: CASE_A,
    tenantId: TENANT_A,
    caseNo: `VIG-${Date.now()}`,
    officer: "Inspector A. Sharma",
    charges: "Misappropriation of departmental funds",
    inquiryStatus: "preliminary_enquiry",
    outcome: "pending",
    createdBy: ACTOR_A,
    updatedBy: ACTOR_A,
  })));
}

async function wipe(): Promise<void> {
  await runWithTenant(TENANT_A, () => db.transaction((tx) => tx.delete(vigilanceCases).where(eq(vigilanceCases.id, CASE_A))));
}

describe("GET /v1/audit/vigilance", () => {
  beforeAll(async () => {
    app = await buildApp();
    await seedCaseForTenantA();
  });

  afterAll(async () => {
    await wipe();
    await app.close();
    await sqlClient.end();
  });

  it("401 when no bearer token is supplied", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/audit/vigilance" });
    expect(res.statusCode).toBe(401);
  });

  it("403 when caller role is not a vigilance reader role", async () => {
    const jwt = token(["employee"], TENANT_A, ACTOR_A);
    const res = await app.inject({
      method: "GET",
      url: "/v1/audit/vigilance",
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it.each(READER_ROLES)("200 for role %s", async (role) => {
    const jwt = token([role], TENANT_A, ACTOR_A);
    const res = await app.inject({
      method: "GET",
      url: "/v1/audit/vigilance",
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body.items)).toBe(true);
    expect(typeof body.total).toBe("number");
  });

  it("tenant A sees the seeded vigilance case", async () => {
    const jwt = token(["audit_officer"], TENANT_A, ACTOR_A);
    const res = await app.inject({
      method: "GET",
      url: "/v1/audit/vigilance",
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    const found = body.items.find((c: { id?: string }) => c.id === CASE_A);
    expect(found).toBeDefined();
    expect(found.caseNo).toContain("VIG-");
    expect(found.officer).toBe("Inspector A. Sharma");
  });

  it("tenant B (different tenant, same reader roles) does NOT see tenant A's case", async () => {
    const jwt = token(["audit_officer"], TENANT_B, ACTOR_B);
    const res = await app.inject({
      method: "GET",
      url: "/v1/audit/vigilance",
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    const leaked = body.items.find((c: { id?: string }) => c.id === CASE_A);
    expect(leaked).toBeUndefined();
  });
});
