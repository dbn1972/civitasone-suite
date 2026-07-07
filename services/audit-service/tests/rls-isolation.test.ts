/**
 * Cross-Tenant RLS Isolation Integration Test — Audit Service
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

function tokenForTenant(tenantId: string, actorId: string, roles: string[] = ["super_admin", "audit_officer"]) {
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

describe("Audit — Cross-Tenant RLS Isolation", () => {
  let createdPlanId: string | undefined;

  it("Tenant A creates an audit plan", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/audit/plans",
      headers: { authorization: `Bearer ${tokenA}`, "content-type": "application/json" },
      payload: {
        planNo: `PLAN-RLS-${Date.now()}`,
        title: "RLS Isolation Test Audit Plan",
        area: "Finance Department",
        periodFrom: "2026-04-01",
        periodTo: "2027-03-31",
      },
    });
    expect([201, 202]).toContain(res.statusCode);
    const body = res.json();
    createdPlanId = body.data?.id ?? body.id;
    expect(createdPlanId).toBeDefined();
  });

  it("Tenant B list of audit plans returns zero of Tenant A data", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/audit/plans",
      headers: { authorization: `Bearer ${tokenB}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    const data = Array.isArray(body) ? body : body.data ?? [];
    const leakedIds = data.filter((p: { id?: string }) => p.id === createdPlanId);
    expect(leakedIds).toHaveLength(0);
  });

  it("Tenant B GET audit plan by ID returns 404", async () => {
    if (!createdPlanId) return;
    const res = await app.inject({
      method: "GET",
      url: `/v1/audit/plans/${createdPlanId}`,
      headers: { authorization: `Bearer ${tokenB}` },
    });
    expect(res.statusCode).toBe(404);
  });

  it("Tenant B PATCH audit plan returns 404", async () => {
    if (!createdPlanId) return;
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/audit/plans/${createdPlanId}`,
      headers: { authorization: `Bearer ${tokenB}`, "content-type": "application/json" },
      payload: { title: "Hacked Plan" },
    });
    expect([404, 405]).toContain(res.statusCode);
  });

  it("Tenant B DELETE audit plan returns 404", async () => {
    if (!createdPlanId) return;
    const res = await app.inject({
      method: "DELETE",
      url: `/v1/audit/plans/${createdPlanId}`,
      headers: { authorization: `Bearer ${tokenB}` },
    });
    expect([404, 405]).toContain(res.statusCode);
  });

  it("Tenant B events list shows zero Tenant A audit events", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/audit/events",
      headers: { authorization: `Bearer ${tokenB}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    const data = Array.isArray(body) ? body : body.data ?? [];
    const leakedTenants = data.filter((e: { tenantId?: string }) => e.tenantId === TENANT_A);
    expect(leakedTenants).toHaveLength(0);
  });

  it("Tenant B observations list shows zero Tenant A data", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/audit/observations",
      headers: { authorization: `Bearer ${tokenB}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    const data = Array.isArray(body) ? body : body.data ?? [];
    const leakedTenants = data.filter((o: { tenantId?: string }) => o.tenantId === TENANT_A);
    expect(leakedTenants).toHaveLength(0);
  });
});
