/**
 * audit-service investigation module tests
 *
 * GET /v1/audit/investigations
 *
 * NOTE: as of writing, the `investigation.investigations` table referenced by
 * src/modules/investigation/schema.ts + repo.ts has NO corresponding entry in
 * services/audit-service/migrations/ — the schema/table was never created in
 * the database (same defect class documented as INV-MIGRATIONS for
 * inventory-service in erp-assessment/15-defect-register.md). Until that
 * migration exists, the seed step and any 200-path assertion below will fail
 * with a Postgres "relation does not exist" error. The 401/403 tests do not
 * touch the database and are expected to pass regardless.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { runWithTenant } from "@civitasone/db";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { investigations } from "../src/modules/investigation/schema.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
function token(roles: string[], tenantId: string, actorId: string) {
  return signToken({ sub: actorId, tid: tenantId, roles, sid: "sess-1" }, SECRET, 3600);
}

const TENANT_A = "cccccccc-0000-4000-8000-000000000001";
const TENANT_B = "dddddddd-0000-4000-8000-000000000002";
const ACTOR_A = "cccccccc-0000-4000-8000-aaaaaaaaaaaa";
const ACTOR_B = "dddddddd-0000-4000-8000-bbbbbbbbbbbb";
const INVESTIGATION_A = "eeeeeeee-0000-4000-8000-000000000001";

const READER_ROLES = ["audit_officer", "audit_admin", "super_admin", "vigilance_officer"];

async function seedInvestigationForTenantA(): Promise<void> {
  await runWithTenant(TENANT_A, () => db.transaction((tx) => tx.insert(investigations).values({
    id: INVESTIGATION_A,
    tenantId: TENANT_A,
    caseId: "CASE-2026-001",
    subject: "Irregular procurement inquiry",
    assignedTo: "officer:vigilance-1",
    findings: "",
    status: "in_progress",
    createdBy: ACTOR_A,
    updatedBy: ACTOR_A,
  })));
}

async function cleanup(): Promise<void> {
  await runWithTenant(TENANT_A, () => db.transaction((tx) => tx.delete(investigations).where(eq(investigations.tenantId, TENANT_A))));
  await runWithTenant(TENANT_B, () => db.transaction((tx) => tx.delete(investigations).where(eq(investigations.tenantId, TENANT_B))));
}

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp();
  await cleanup();
  await seedInvestigationForTenantA();
});

afterAll(async () => {
  await cleanup();
  await app.close();
  await sqlClient.end();
});

describe("GET /v1/audit/investigations — auth", () => {
  it("401 when no token is provided", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/audit/investigations",
    });
    expect(res.statusCode).toBe(401);
  });

  it("403 for a role without read access (employee)", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/audit/investigations",
      headers: { authorization: `Bearer ${token(["employee"], TENANT_A, ACTOR_A)}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it.each(READER_ROLES)("200 for role %s", async (role) => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/audit/investigations",
      headers: { authorization: `Bearer ${token([role], TENANT_A, ACTOR_A)}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body.items)).toBe(true);
  });
});

describe("GET /v1/audit/investigations — tenant isolation", () => {
  it("Tenant A sees the seeded investigation", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/audit/investigations",
      headers: { authorization: `Bearer ${token(["audit_officer"], TENANT_A, ACTOR_A)}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    const ids = (body.items as Array<{ id: string }>).map((i) => i.id);
    expect(ids).toContain(INVESTIGATION_A);
  });

  it("Tenant B does NOT see Tenant A's investigation", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/audit/investigations",
      headers: { authorization: `Bearer ${token(["audit_officer"], TENANT_B, ACTOR_B)}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    const ids = (body.items as Array<{ id: string }>).map((i) => i.id);
    expect(ids).not.toContain(INVESTIGATION_A);
  });
});
