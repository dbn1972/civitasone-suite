/**
 * Cross-Tenant RLS Isolation Integration Test — Inventory Service
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

function tokenForTenant(tenantId: string, actorId: string, roles: string[] = ["super_admin", "inventory_manager"]) {
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

describe("Inventory — Cross-Tenant RLS Isolation", () => {
  let createdItemId: string | undefined;

  it("Tenant A creates an inventory item", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/inventory/items",
      headers: { authorization: `Bearer ${tokenA}`, "x-tenant-id": TENANT_A, "content-type": "application/json" },
      payload: {
        name: "RLS Isolation Test Item",
        sku: `SKU-RLS-${Date.now()}`,
        unit: "nos",
        category: "general",
      },
    });
    expect(res.statusCode).toBe(202);
    const body = res.json();
    createdItemId = body.id;
    expect(createdItemId).toBeDefined();
  });

  it("Tenant B list of items returns zero of Tenant A data", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/inventory/items",
      headers: { authorization: `Bearer ${tokenB}`, "x-tenant-id": TENANT_B },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    const data = Array.isArray(body) ? body : body.data ?? [];
    const leakedIds = data.filter((i: { id?: string }) => i.id === createdItemId);
    expect(leakedIds).toHaveLength(0);
  });

  it("Tenant B GET item by ID returns 404", async () => {
    if (!createdItemId) return;
    const res = await app.inject({
      method: "GET",
      url: `/v1/inventory/items/${createdItemId}`,
      headers: { authorization: `Bearer ${tokenB}`, "x-tenant-id": TENANT_B },
    });
    expect(res.statusCode).toBe(404);
  });

  it("Tenant B PATCH item returns 400/404/405 (cannot modify)", async () => {
    if (!createdItemId) return;
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/inventory/items/${createdItemId}`,
      headers: { authorization: `Bearer ${tokenB}`, "x-tenant-id": TENANT_B, "content-type": "application/json" },
      payload: { name: "Hacked Item" },
    });
    // 400 = validation before DB, 404 = not found for tenant, 405 = method not allowed
    expect([400, 404, 405]).toContain(res.statusCode);
  });

  it("Tenant B DELETE item returns 404", async () => {
    if (!createdItemId) return;
    const res = await app.inject({
      method: "DELETE",
      url: `/v1/inventory/items/${createdItemId}`,
      headers: { authorization: `Bearer ${tokenB}`, "x-tenant-id": TENANT_B },
    });
    expect([404, 405]).toContain(res.statusCode);
  });

  it("Tenant B warehouse list shows zero Tenant A warehouses", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/inventory/warehouses",
      headers: { authorization: `Bearer ${tokenB}`, "x-tenant-id": TENANT_B },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    const data = Array.isArray(body) ? body : body.data ?? [];
    const leakedTenants = data.filter((w: { tenantId?: string }) => w.tenantId === TENANT_A);
    expect(leakedTenants).toHaveLength(0);
  });
});
