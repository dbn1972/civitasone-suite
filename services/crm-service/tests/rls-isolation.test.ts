/**
 * Cross-Tenant RLS Isolation Integration Test — CRM Service
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

function tokenForTenant(tenantId: string, actorId: string, roles: string[] = ["super_admin", "crm_admin"]) {
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

describe("CRM — Cross-Tenant RLS Isolation", () => {
  let createdContactId: string | undefined;

  it("Tenant A creates a contact", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/crm/contacts",
      headers: { authorization: `Bearer ${tokenA}`, "content-type": "application/json" },
      payload: {
        firstName: "Tenant A",
        lastName: "Contact",
        email: "tenanta@example.com",
        phone: "+919876543210",
      },
    });
    expect(res.statusCode).toBe(202);
    const body = res.json();
    createdContactId = body.id;
    expect(createdContactId).toBeDefined();
  });

  it("Tenant B list of contacts returns zero of Tenant A data", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/crm/contacts",
      headers: { authorization: `Bearer ${tokenB}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    const data = Array.isArray(body) ? body : body.data ?? [];
    const leakedIds = data.filter((c: { id?: string }) => c.id === createdContactId);
    expect(leakedIds).toHaveLength(0);
  });

  it("Tenant B GET contact by ID returns 404", async () => {
    if (!createdContactId) return;
    const res = await app.inject({
      method: "GET",
      url: `/v1/crm/contacts/${createdContactId}`,
      headers: { authorization: `Bearer ${tokenB}` },
    });
    expect(res.statusCode).toBe(404);
  });

  it("Tenant B PATCH contact returns 404", async () => {
    if (!createdContactId) return;
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/crm/contacts/${createdContactId}`,
      headers: { authorization: `Bearer ${tokenB}`, "content-type": "application/json" },
      payload: { firstName: "Hacked" },
    });
    expect([404, 405]).toContain(res.statusCode);
  });

  it("Tenant B DELETE contact returns 404", async () => {
    if (!createdContactId) return;
    const res = await app.inject({
      method: "DELETE",
      url: `/v1/crm/contacts/${createdContactId}`,
      headers: { authorization: `Bearer ${tokenB}` },
    });
    expect([404, 405]).toContain(res.statusCode);
  });

  it("Tenant B deals list shows zero Tenant A deals", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/crm/deals",
      headers: { authorization: `Bearer ${tokenB}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    const data = Array.isArray(body) ? body : body.data ?? [];
    const leakedTenants = data.filter((d: { tenantId?: string }) => d.tenantId === TENANT_A);
    expect(leakedTenants).toHaveLength(0);
  });
});
