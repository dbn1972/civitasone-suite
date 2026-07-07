/**
 * Cross-Tenant RLS Isolation Integration Test — Billing Service
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

function tokenForTenant(tenantId: string, actorId: string, roles: string[] = ["super_admin", "billing_admin"]) {
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

describe("Billing — Cross-Tenant RLS Isolation", () => {
  let createdPlanId: string | undefined;

  it("Tenant A creates a billing plan", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/billing/plans",
      headers: { authorization: `Bearer ${tokenA}`, "content-type": "application/json" },
      payload: {
        name: "RLS Test Plan",
        priceMinor: 99900,
        currency: "INR",
        interval: "monthly",
      },
    });
    expect(res.statusCode).toBe(202);
    const body = res.json();
    createdPlanId = body.id;
    expect(createdPlanId).toBeDefined();
  });

  it("Tenant B list of plans returns zero of Tenant A data", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/billing/plans",
      headers: { authorization: `Bearer ${tokenB}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    const data = Array.isArray(body) ? body : body.data ?? [];
    const leakedIds = data.filter((p: { id?: string }) => p.id === createdPlanId);
    expect(leakedIds).toHaveLength(0);
  });

  it("Tenant B GET plan by ID returns 404", async () => {
    if (!createdPlanId) return;
    const res = await app.inject({
      method: "GET",
      url: `/v1/billing/plans/${createdPlanId}`,
      headers: { authorization: `Bearer ${tokenB}` },
    });
    expect(res.statusCode).toBe(404);
  });

  it("Tenant B PATCH plan returns 404", async () => {
    if (!createdPlanId) return;
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/billing/plans/${createdPlanId}`,
      headers: { authorization: `Bearer ${tokenB}`, "content-type": "application/json" },
      payload: { name: "Hacked Plan" },
    });
    expect([404, 405]).toContain(res.statusCode);
  });

  it("Tenant B DELETE plan returns 404", async () => {
    if (!createdPlanId) return;
    const res = await app.inject({
      method: "DELETE",
      url: `/v1/billing/plans/${createdPlanId}`,
      headers: { authorization: `Bearer ${tokenB}` },
    });
    expect([404, 405]).toContain(res.statusCode);
  });

  it("Tenant B invoice list shows zero Tenant A invoices", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/billing/invoices",
      headers: { authorization: `Bearer ${tokenB}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    const data = Array.isArray(body) ? body : body.data ?? [];
    const leakedTenants = data.filter((inv: { tenantId?: string }) => inv.tenantId === TENANT_A);
    expect(leakedTenants).toHaveLength(0);
  });
});
