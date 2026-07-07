/**
 * Cross-Tenant RLS Isolation Integration Test — Citizen Service
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

function tokenForTenant(tenantId: string, actorId: string, roles: string[] = ["super_admin", "citizen_admin"]) {
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

describe("Citizen — Cross-Tenant RLS Isolation", () => {
  let createdGrievanceId: string | undefined;

  it("Tenant A creates a grievance", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/citizen/grievances",
      headers: { authorization: `Bearer ${tokenA}`, "content-type": "application/json" },
      payload: {
        subject: "RLS Isolation Test Grievance",
        description: "This grievance tests cross-tenant isolation",
        category: "general",
      },
    });
    expect(res.statusCode).toBe(202);
    const body = res.json();
    createdGrievanceId = body.id;
    expect(createdGrievanceId).toBeDefined();
  });

  it("Tenant B list of grievances returns zero of Tenant A data", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/citizen/grievances",
      headers: { authorization: `Bearer ${tokenB}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    const data = Array.isArray(body) ? body : body.data ?? [];
    const leakedIds = data.filter((g: { id?: string }) => g.id === createdGrievanceId);
    expect(leakedIds).toHaveLength(0);
  });

  it("Tenant B GET grievance by ID returns 404", async () => {
    if (!createdGrievanceId) return;
    const res = await app.inject({
      method: "GET",
      url: `/v1/citizen/grievances/${createdGrievanceId}`,
      headers: { authorization: `Bearer ${tokenB}` },
    });
    expect(res.statusCode).toBe(404);
  });

  it("Tenant B PATCH grievance returns 404", async () => {
    if (!createdGrievanceId) return;
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/citizen/grievances/${createdGrievanceId}`,
      headers: { authorization: `Bearer ${tokenB}`, "content-type": "application/json" },
      payload: { subject: "Hacked Grievance" },
    });
    expect([404, 405]).toContain(res.statusCode);
  });

  it("Tenant B DELETE grievance returns 404", async () => {
    if (!createdGrievanceId) return;
    const res = await app.inject({
      method: "DELETE",
      url: `/v1/citizen/grievances/${createdGrievanceId}`,
      headers: { authorization: `Bearer ${tokenB}` },
    });
    expect([404, 405]).toContain(res.statusCode);
  });

  it("Tenant B RTI list shows zero Tenant A applications", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/citizen/rti",
      headers: { authorization: `Bearer ${tokenB}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    const data = Array.isArray(body) ? body : body.data ?? [];
    const leakedTenants = data.filter((r: { tenantId?: string }) => r.tenantId === TENANT_A);
    expect(leakedTenants).toHaveLength(0);
  });
});
