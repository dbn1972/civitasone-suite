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
 * set in that Postgres session, i.e. any db.transaction() that runs with no
 * tenant context (see packages/db/src/wrap-tenant-db.ts). That raised a raw
 * PostgresError, surfaced as an HTTP 500, instead of current_tenant_id()'s
 * NULLIF(current_setting('app.tenant_id', true), '') pattern, which returns
 * NULL and lets RLS gracefully filter to zero rows — the behavior every
 * sibling table (items, stores, etc.) already has.
 *
 * Fixed in 0021_canonical_warehouses_rls_tenant_guc_fix.sql by switching the
 * policy to current_tenant_id().
 *
 * UAT bundle 10 F2 (PR #2428) changed how a request gets its GUC:
 * createTenantTxHook now scopes it to the VERIFIED tenant (req.ctx.tenantId,
 * i.e. the token's tid), not the x-tenant-id header. So "authenticated, no
 * x-tenant-id header" no longer means "no GUC": a tid-bearing token now sees
 * its own tenant's rows (asserted below). The no-GUC path this regression
 * guards is therefore exercised directly: the real listWarehouses() read
 * (scopedRead -> db.transaction) run OUTSIDE any request / tenant context,
 * after first proving that such a transaction really has no app.tenant_id.
 * (An HTTP request whose token has no tid cannot reach this policy cleanly:
 * the route's own `tenant_id = ''` predicate fails the uuid cast first.)
 *
 * F2 also changed the cross-request AsyncLocalStorage leak this file used to
 * work around: the hook used to call enterWith() only when a header was
 * present and never reset it, so a stale tenant could leak into a later
 * no-header request in the same process. It now always enters the verified
 * tenant, and clears an inherited store when a request has none.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { sql } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { getCurrentTenantId } from "@civitasone/db";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { listWarehouses } from "../src/modules/warehouses/queries.js";
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

describe("Warehouses — no app.tenant_id GUC set", () => {
  it("a read with no tenant context really runs with no app.tenant_id GUC", async () => {
    expect(getCurrentTenantId()).toBeFalsy();
    const rows = (await db.transaction(async (tx) =>
      tx.execute(sql`select current_setting('app.tenant_id', true) as t`),
    )) as unknown as Array<{ t: string | null }>;
    expect(rows[0]?.t ?? "").toBe("");
  });

  it("the real warehouses read returns empty (no error -> no 500) when no GUC is set", async () => {
    // Before 0021 this threw `unrecognized configuration parameter "app.tenant_id"`.
    await expect(listWarehouses(TENANT_A, 50, 0)).resolves.toHaveLength(0);
  });
});

describe("Warehouses — request tenant comes from the verified token (F2)", () => {
  it("a tid token with NO x-tenant-id header gets its own tenant's warehouse", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/inventory/warehouses",
      headers: { authorization: `Bearer ${tokenA}` }, // deliberately no x-tenant-id
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    const data = Array.isArray(body) ? body : body.data ?? [];
    expect(data.some((w: { code?: string }) => w.code === SEEDED_CODE)).toBe(true);
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
