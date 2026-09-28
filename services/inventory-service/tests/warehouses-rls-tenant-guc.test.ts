/**
 * Regression test — inventory.warehouses' tenant_isolation RLS policy
 * (services/inventory-service/migrations/0010_canonical_warehouses.sql)
 * inlined current_setting('app.tenant_id')::uuid instead of the shared
 * current_tenant_id() helper (0003_rls_tenant_isolation.sql /
 * 0004_rls_full_tenant_isolation.sql) every sibling table in this service
 * uses.
 *
 * Bug: current_setting('app.tenant_id') with no missing_ok argument raises
 * `unrecognized configuration parameter "app.tenant_id"` whenever a
 * connection queries this FORCE RLS table without app.tenant_id having been
 * set in that Postgres session — e.g. an authenticated request with no
 * x-tenant-id header, so createTenantTxHook's AsyncLocalStorage tenant
 * context is empty and db.transaction() runs with no GUC set (see
 * packages/db/src/wrap-tenant-db.ts). That raised a raw PostgresError which
 * `registerErrorHandler`'s fallback surfaces as an HTTP 500, instead of
 * current_tenant_id()'s NULLIF(current_setting('app.tenant_id', true), '')
 * pattern, which returns NULL and lets RLS gracefully filter to zero rows —
 * the behavior every sibling table (items, stores, etc.) already has.
 *
 * Fixed in 0021_canonical_warehouses_rls_tenant_guc_fix.sql by switching the
 * policy to current_tenant_id().
 *
 * This lives in its own file (rather than appended to rls-isolation.test.ts)
 * deliberately: createTenantTxHook only calls tenantStorage.enterWith() when
 * an x-tenant-id header IS present and never resets it when one is absent,
 * so within a single test FILE/process, an earlier test's header-bearing
 * app.inject() call can leave a stale tenant context that a later
 * no-header request inherits (AsyncLocalStorage's enterWith persists across
 * subsequent asynchronous calls until something else changes it). Each
 * vitest test file gets its own fresh buildApp()/module state, so a
 * dedicated file with no prior header-bearing request keeps this test
 * deterministic. That cross-request leak is a pre-existing characteristic
 * of createTenantTxHook shared fleet-wide (packages/db/src/tenant-tx.ts) —
 * out of scope for this migration-level fix.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import type { FastifyInstance } from "fastify";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT_A = "cccccccc-0000-4000-8000-000000000003";
const ACTOR_A = "cccccccc-0000-4000-8000-cccccccccccc";
const SEEDED_CODE = `WH-RLS-REGRESSION-${Date.now()}`;

function tokenForTenant(tenantId: string, actorId: string, roles: string[] = ["super_admin", "inventory_manager"]) {
  return signToken({ sub: actorId, tid: tenantId, roles, sid: "sess-rls-guc" }, SECRET, 3600);
}

let app: FastifyInstance;
let tokenA: string;

beforeAll(async () => {
  app = await buildApp();
  tokenA = tokenForTenant(TENANT_A, ACTOR_A);

  // Seed directly via SQL — SET LOCAL-equivalent set_config(..., true) inside
  // a transaction, the same pattern data-quality.test.ts uses — rather than
  // through the async command/outbox path, so this test doesn't depend on
  // worker consumption timing.
  await sqlClient.begin(async (tx) => {
    await tx`SELECT set_config('app.tenant_id', ${TENANT_A}, true)`;
    await tx`
      INSERT INTO inventory.warehouses (tenant_id, name, code, created_by, updated_by)
      VALUES (${TENANT_A}, 'RLS Regression Warehouse', ${SEEDED_CODE}, ${ACTOR_A}, ${ACTOR_A})
    `;
  });
});

afterAll(async () => {
  await app.close();
  await sqlClient.end();
});

describe("Warehouses — no app.tenant_id GUC set (missing x-tenant-id header)", () => {
  it("returns 200 with empty data instead of 500 when no x-tenant-id header is sent", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/inventory/warehouses",
      headers: { authorization: `Bearer ${tokenA}` }, // deliberately no x-tenant-id
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    const data = Array.isArray(body) ? body : body.data ?? [];
    expect(data).toHaveLength(0);
  });

  it("still returns the tenant's own warehouse when x-tenant-id IS sent (isolation intact)", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/inventory/warehouses",
      headers: { authorization: `Bearer ${tokenA}`, "x-tenant-id": TENANT_A },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    const data = Array.isArray(body) ? body : body.data ?? [];
    expect(data.some((w: { code?: string }) => w.code === SEEDED_CODE)).toBe(true);
  });
});
