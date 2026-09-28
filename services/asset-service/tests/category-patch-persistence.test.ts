/**
 * Regression test — PATCH /v1/assets/categories/:id was a silent no-op for
 * every tenant: repo.updateCategory() ran `db.update(...)` on the bare `db`
 * handle, outside `db.transaction()`. wrapWithTenantGuc only hooks
 * `.transaction()`, so no `app.tenant_id` GUC was set, and register
 * .asset_categories's FORCE RLS tenant_isolation_policy
 * (tenant_id = current_tenant_id(), NULL when unset) matched zero rows. A
 * 0-row UPDATE is not a Postgres error, so the route still returned 200.
 *
 * platform-category-read.test.ts already covers this table's RLS policy,
 * but it reads/writes via `withTenantScope` + raw SQL, which sets the GUC
 * itself — it never goes through repo.updateCategory()/this route, so it
 * could not have caught this bug. This test drives the real HTTP route and
 * re-fetches through the real read path (GET /v1/assets/categories) so a
 * regression here shows up as a failing assertion on the persisted value,
 * not just a 200 status code.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import type { FastifyInstance } from "fastify";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";

const TENANT_A = "5aaaaaaa-0000-4000-8000-000000000001";
const TENANT_B = "5bbbbbbb-0000-4000-8000-000000000002";
const ACTOR_A = "5aaaaaaa-0000-4000-8000-aaaaaaaaaaaa";
const ACTOR_B = "5bbbbbbb-0000-4000-8000-bbbbbbbbbbbb";

function tokenForTenant(tenantId: string, actorId: string): string {
  return signToken({ sub: actorId, tid: tenantId, roles: ["super_admin", "asset_admin"], sid: "sess-cat-patch" }, SECRET, 3600);
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

type CategoryDto = { id: string; name: string; updatedAt: string; version: number };

async function createCategory(token: string, name: string): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: "/v1/assets/categories",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    payload: {
      name,
      code: `CAT-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      depMethod: "SLM",
      depRate: 10,
      usefulLifeYears: 5,
    },
  });
  expect(res.statusCode, "category creation must succeed").toBe(201);
  return (res.json() as { id: string }).id;
}

async function listCategories(token: string): Promise<CategoryDto[]> {
  const res = await app.inject({
    method: "GET",
    url: "/v1/assets/categories",
    headers: { authorization: `Bearer ${token}` },
  });
  expect(res.statusCode).toBe(200);
  return (res.json() as { data: CategoryDto[] }).data;
}

describe("PATCH /v1/assets/categories/:id — tenant-scoped write actually persists", () => {
  it("persists name/updatedAt/version, re-fetched via the real read path (not raw SQL)", async () => {
    const id = await createCategory(tokenA, "Original Name");
    const before = (await listCategories(tokenA)).find((c) => c.id === id);
    expect(before, "category must be visible right after creation").toBeTruthy();

    const patchRes = await app.inject({
      method: "PATCH",
      url: `/v1/assets/categories/${id}`,
      headers: { authorization: `Bearer ${tokenA}`, "content-type": "application/json" },
      payload: { name: "Renamed Category" },
    });
    expect(patchRes.statusCode, "PATCH must report success").toBe(200);

    const after = (await listCategories(tokenA)).find((c) => c.id === id);
    expect(after, "category must still be visible after PATCH").toBeTruthy();
    // This is exactly what the bug defeated: the route answered 200 but the
    // UPDATE touched zero rows, so re-fetching still showed the ORIGINAL
    // name/updatedAt/version. A regression here means the write is a no-op
    // again, even though the HTTP response looks fine.
    expect(after!.name).toBe("Renamed Category");
    expect(new Date(after!.updatedAt).getTime()).toBeGreaterThan(new Date(before!.updatedAt).getTime());
    expect(after!.version).toBeGreaterThan(before!.version);
  });

  it("a second tenant's token cannot update tenant A's category", async () => {
    const id = await createCategory(tokenA, "Tenant A Only");

    const crossTenantPatch = await app.inject({
      method: "PATCH",
      url: `/v1/assets/categories/${id}`,
      headers: { authorization: `Bearer ${tokenB}`, "content-type": "application/json" },
      payload: { name: "Hijacked" },
    });
    expect(crossTenantPatch.statusCode, "cross-tenant PATCH must 404, not succeed").toBe(404);

    const stillAsOwner = (await listCategories(tokenA)).find((c) => c.id === id);
    expect(stillAsOwner!.name, "tenant A's category must be unaffected by tenant B's attempt").toBe("Tenant A Only");

    const asOtherTenant = (await listCategories(tokenB)).find((c) => c.id === id);
    expect(asOtherTenant, "tenant B must not see tenant A's category at all").toBeUndefined();
  });
});
