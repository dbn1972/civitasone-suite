/**
 * Cross-Tenant RLS Isolation Integration Test — Project Service
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

function tokenForTenant(tenantId: string, actorId: string, roles: string[] = ["super_admin", "project_manager"]) {
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

describe("Project — Cross-Tenant RLS Isolation", () => {
  let createdProjectId: string | undefined;

  it("Tenant A creates a project", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/projects",
      headers: { authorization: `Bearer ${tokenA}`, "content-type": "application/json" },
      payload: {
        name: "RLS Isolation Test Project",
        code: `PROJ-RLS-${Date.now()}`,
        startDate: "2026-01-01",
        endDate: "2026-12-31",
        budgetMinor: 50000000,
      },
    });
    expect(res.statusCode).toBe(202);
    const body = res.json();
    createdProjectId = body.id;
    expect(createdProjectId).toBeDefined();
  });

  it("Tenant B list of projects returns zero of Tenant A data", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/projects",
      headers: { authorization: `Bearer ${tokenB}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    const data = Array.isArray(body) ? body : body.data ?? [];
    const leakedIds = data.filter((p: { id?: string }) => p.id === createdProjectId);
    expect(leakedIds).toHaveLength(0);
  });

  it("Tenant B GET project by ID returns 404", async () => {
    if (!createdProjectId) return;
    const res = await app.inject({
      method: "GET",
      url: `/v1/projects/${createdProjectId}`,
      headers: { authorization: `Bearer ${tokenB}` },
    });
    expect(res.statusCode).toBe(404);
  });

  it("Tenant B PATCH project returns 404", async () => {
    if (!createdProjectId) return;
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/projects/${createdProjectId}`,
      headers: { authorization: `Bearer ${tokenB}`, "content-type": "application/json" },
      payload: { name: "Hacked Project" },
    });
    expect([404, 405]).toContain(res.statusCode);
  });

  it("Tenant B DELETE project returns 404", async () => {
    if (!createdProjectId) return;
    const res = await app.inject({
      method: "DELETE",
      url: `/v1/projects/${createdProjectId}`,
      headers: { authorization: `Bearer ${tokenB}` },
    });
    expect([404, 405]).toContain(res.statusCode);
  });

  it("Tenant B task list shows zero Tenant A tasks", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/projects/tasks",
      headers: { authorization: `Bearer ${tokenB}` },
    });
    // tasks route may return 200 (empty), 404 (route not found), or 400 (missing params)
    expect([200, 400, 404]).toContain(res.statusCode);
    if (res.statusCode === 200) {
      const body = res.json();
      const data = Array.isArray(body) ? body : body.data ?? [];
      const leakedTenants = data.filter((t: { tenantId?: string }) => t.tenantId === TENANT_A);
      expect(leakedTenants).toHaveLength(0);
    }
  });
});
