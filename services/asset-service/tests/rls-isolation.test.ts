/**
 * Cross-Tenant RLS Isolation Integration Test — Asset Service
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

function tokenForTenant(tenantId: string, actorId: string, roles: string[] = ["super_admin", "asset_officer"]) {
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

describe("Asset — Cross-Tenant RLS Isolation", () => {
  let createdAssetId: string | undefined;

  it("Tenant A creates an asset", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/assets/assets",
      headers: { authorization: `Bearer ${tokenA}`, "content-type": "application/json" },
      payload: {
        name: "RLS Isolation Test Asset",
        code: `ASSET-RLS-${Date.now()}`,
        categoryId: "eeeeeeee-0001-0000-0000-000000000001",
        acquisitionDate: "2026-01-15",
        acquisitionCost: 5000000,
      },
    });
    expect([201, 202]).toContain(res.statusCode);
    const body = res.json();
    createdAssetId = body.data?.id ?? body.id;
    expect(createdAssetId).toBeDefined();
  });

  it("Tenant B list of assets returns zero of Tenant A data", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/assets/assets",
      headers: { authorization: `Bearer ${tokenB}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    const data = Array.isArray(body) ? body : body.data ?? [];
    const leakedIds = data.filter((a: { id?: string }) => a.id === createdAssetId);
    expect(leakedIds).toHaveLength(0);
  });

  it("Tenant B GET asset by ID returns 404", async () => {
    if (!createdAssetId) return;
    const res = await app.inject({
      method: "GET",
      url: `/v1/assets/assets/${createdAssetId}`,
      headers: { authorization: `Bearer ${tokenB}` },
    });
    expect(res.statusCode).toBe(404);
  });

  it("Tenant B PATCH asset returns 404", async () => {
    if (!createdAssetId) return;
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/assets/assets/${createdAssetId}`,
      headers: { authorization: `Bearer ${tokenB}`, "content-type": "application/json" },
      payload: { name: "Hacked Asset" },
    });
    expect([404, 405]).toContain(res.statusCode);
  });

  it("Tenant B DELETE asset returns 404", async () => {
    if (!createdAssetId) return;
    const res = await app.inject({
      method: "DELETE",
      url: `/v1/assets/assets/${createdAssetId}`,
      headers: { authorization: `Bearer ${tokenB}` },
    });
    expect([404, 405]).toContain(res.statusCode);
  });

  it("Tenant B maintenance list shows zero Tenant A data", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/assets/maintenance",
      headers: { authorization: `Bearer ${tokenB}` },
    });
    expect([200, 404]).toContain(res.statusCode);
    if (res.statusCode === 200) {
      const body = res.json();
      const data = Array.isArray(body) ? body : body.data ?? [];
      const leakedTenants = data.filter((m: { tenantId?: string }) => m.tenantId === TENANT_A);
      expect(leakedTenants).toHaveLength(0);
    }
  });
});
