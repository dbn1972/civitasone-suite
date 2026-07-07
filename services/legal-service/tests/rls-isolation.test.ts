/**
 * Cross-Tenant RLS Isolation Integration Test — Legal Service
 *
 * Validates: Requirements 1.5, 1.6
 * - Tenant A creates resource, Tenant B attempts read/update/delete → 0 rows / 404
 * - Attempts to access a specific Tenant B resource by ID return HTTP 404 (not 403)
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import type { FastifyInstance } from "fastify";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";

const TENANT_A = "aaaaaaaa-0000-4000-8000-000000000001";
const TENANT_B = "bbbbbbbb-0000-4000-8000-000000000002";
const ACTOR_A = "aaaaaaaa-0000-4000-8000-aaaaaaaaaaaa";
const ACTOR_B = "bbbbbbbb-0000-4000-8000-bbbbbbbbbbbb";

function tokenForTenant(tenantId: string, actorId: string, roles: string[] = ["super_admin", "legal_officer"]) {
  return signToken({ sub: actorId, tid: tenantId, roles, sid: "sess-rls" }, SECRET, 3600);
}

let app: FastifyInstance;
let tokenA: string;
let tokenB: string;

beforeAll(async () => {
  app = await buildApp();
  tokenA = tokenForTenant(TENANT_A, ACTOR_A);
  tokenB = tokenForTenant(TENANT_B, ACTOR_B);
});

afterAll(async () => {
  await app.close();
  await sqlClient.end();
});

describe("Legal — Cross-Tenant RLS Isolation", () => {
  let createdCaseId: string | undefined;

  it("Tenant A creates a legal case/matter", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/legal/cases",
      headers: { authorization: `Bearer ${tokenA}`, "content-type": "application/json" },
      payload: {
        caseNo: `CASE-RLS-${Date.now()}`,
        title: "RLS Isolation Test Case",
        court: "High Court",
      },
    });
    expect(res.statusCode).toBe(202);
    const body = res.json();
    createdCaseId = body.id;
    expect(createdCaseId).toBeDefined();
  });

  it("Tenant B list of cases returns zero of Tenant A data", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/legal/cases",
      headers: { authorization: `Bearer ${tokenB}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    const data = Array.isArray(body) ? body : body.data ?? [];
    const leakedIds = data.filter((c: { id?: string }) => c.id === createdCaseId);
    expect(leakedIds).toHaveLength(0);
  });

  it("Tenant B GET case by ID returns 404", async () => {
    if (!createdCaseId) return;
    const res = await app.inject({
      method: "GET",
      url: `/v1/legal/cases/${createdCaseId}`,
      headers: { authorization: `Bearer ${tokenB}` },
    });
    expect(res.statusCode).toBe(404);
  });

  it("Tenant B PATCH case returns 404", async () => {
    if (!createdCaseId) return;
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/legal/cases/${createdCaseId}`,
      headers: { authorization: `Bearer ${tokenB}`, "content-type": "application/json" },
      payload: { title: "Hacked Case" },
    });
    expect([404, 405]).toContain(res.statusCode);
  });

  it("Tenant B DELETE case returns 404", async () => {
    if (!createdCaseId) return;
    const res = await app.inject({
      method: "DELETE",
      url: `/v1/legal/cases/${createdCaseId}`,
      headers: { authorization: `Bearer ${tokenB}` },
    });
    expect([404, 405]).toContain(res.statusCode);
  });
});
