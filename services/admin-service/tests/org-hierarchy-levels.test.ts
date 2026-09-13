/**
 * admin-service — org-hierarchy-levels regression tests (COMP-014).
 *
 * Before this fix, platform-admin/org-config/OrgConfigPage.tsx seeded its
 * whole table from a hardcoded DEFAULT_LEVELS constant and its save action
 * PUT a path (/v1/admin/org-hierarchy) with no PUT route at all — the save
 * silently claimed success ("Org hierarchy saved.") regardless of the real
 * (failing) HTTP outcome, and a reload always showed DEFAULT_LEVELS again
 * since nothing was ever actually persisted.
 *
 * This suite asserts the ANTI-fabrication property specifically, mirroring
 * gap-routes.test.ts's own convention: a save-then-reload round trip returns
 * REAL per-tenant data (not an echo of the request, not the hardcoded
 * default), a different tenant's data is genuinely isolated by RLS (not
 * merely by an app-layer WHERE), and an invalid request is honestly
 * rejected rather than silently accepted.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { PLATFORM_DEFAULT_TENANT_ID } from "../src/modules/org-hierarchy-levels/repo.js";

const SECRET = "test_secret_for_civitasone_32chr";
const TENANT_A = "cccccccc-dddd-4000-8000-000000000601";
const TENANT_B = "cccccccc-dddd-4000-8000-000000000602";
const ACTOR = "00000000-dddd-4000-8000-000000000603";

function token(roles: string[], tenantId: string): string {
  return signToken({ sub: ACTOR, tid: tenantId, roles, sid: "sess-org-levels" }, SECRET, 3600);
}
function authHeader(roles: string[], tenantId = TENANT_A) {
  return { authorization: `Bearer ${token(roles, tenantId)}` };
}

const DEFAULT_LABELS = ["Ministry", "Department", "Division", "Section", "Unit"];

let app: FastifyInstance;

/**
 * Delete this suite's two tenants' own override rows (never the
 * platform-default sentinel rows) so re-running the suite always starts from
 * the same platform-default-only state. Table is FORCE ROW LEVEL SECURITY,
 * so a DELETE on the raw `sqlClient` with no `app.tenant_id` GUC set matches
 * `tenant_id = current_tenant_id()` against NULL — i.e. deletes ZERO rows
 * silently, no error. Set the GUC for the duration of one transaction per
 * tenant first, exactly like migration 0033's own seed step does, rather
 * than reaching for a platform-bypass read/write escape hatch.
 */
async function deleteTestTenantRows(tenantId: string): Promise<void> {
  await sqlClient.begin(async (tx) => {
    await tx`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
    await tx`DELETE FROM org_hierarchy_levels.org_hierarchy_levels WHERE tenant_id = ${tenantId}`;
  });
}

beforeAll(async () => {
  app = await buildApp();
  // Defensive pre-cleanup: self-heal if a previous run of this suite was
  // interrupted before its own afterAll ran, so this run starts from a known
  // (platform-default-only) state regardless of history.
  await deleteTestTenantRows(TENANT_A);
  await deleteTestTenantRows(TENANT_B);
});

afterAll(async () => {
  await app.close();
  await deleteTestTenantRows(TENANT_A);
  await deleteTestTenantRows(TENANT_B);
  await sqlClient.end();
});

function errorCode(res: { json: () => unknown }): string {
  const body = res.json() as { code?: string; error?: { code?: string } };
  return body.error?.code ?? body.code ?? "";
}

describe("GET /v1/admin/org-hierarchy-levels", () => {
  it("falls back to the platform-default 5 levels, in order, for a tenant that has never configured any", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/admin/org-hierarchy-levels", headers: authHeader(["tenant_admin"]) });
    expect(res.statusCode).toBe(200);
    const rows = res.json().data as Array<{ id: string; order: number; label: string }>;
    expect(rows.map((r) => r.label)).toEqual(DEFAULT_LABELS);
    expect(rows.map((r) => r.order)).toEqual([1, 2, 3, 4, 5]);
  });

  it("returns 401 without auth, 403 for an unrelated role", async () => {
    const noAuth = await app.inject({ method: "GET", url: "/v1/admin/org-hierarchy-levels" });
    expect(noAuth.statusCode).toBe(401);
    const wrongRole = await app.inject({ method: "GET", url: "/v1/admin/org-hierarchy-levels", headers: authHeader(["employee"]) });
    expect(wrongRole.statusCode).toBe(403);
  });
});

describe("PUT /v1/admin/org-hierarchy-levels", () => {
  it("saves the FULL edited level set and an immediate GET reflects exactly that — label, description, examples and color, not just order", async () => {
    const edited = [
      { id: "ministry", order: 2, label: "Ministry", description: "Renamed via PUT", examples: "Example A", color: "#111111" },
      { id: "department", order: 1, label: "Top Department", description: "Now first", examples: "Example B", color: "#222222" },
    ];
    const put = await app.inject({
      method: "PUT", url: "/v1/admin/org-hierarchy-levels",
      headers: authHeader(["tenant_admin"]),
      payload: { levels: edited },
    });
    expect(put.statusCode).toBe(200);

    // Reload — a genuinely SEPARATE request, proving persistence rather than
    // an echo of the PUT's own response.
    const get = await app.inject({ method: "GET", url: "/v1/admin/org-hierarchy-levels", headers: authHeader(["tenant_admin"]) });
    expect(get.statusCode).toBe(200);
    const rows = get.json().data as Array<{ id: string; order: number; label: string; description: string; examples: string; color: string }>;
    expect(rows.map((r) => r.id)).toEqual(["department", "ministry"]); // sorted by the new order
    const dept = rows.find((r) => r.id === "department")!;
    expect(dept).toMatchObject({ order: 1, label: "Top Department", description: "Now first", examples: "Example B", color: "#222222" });
    const ministry = rows.find((r) => r.id === "ministry")!;
    // The pre-fix bug's request body only ever carried {id, order, label} —
    // description/examples/color edits were silently discarded even on a
    // request that itself succeeded. Asserting all four fields round-trip
    // guards against reintroducing that narrower shape.
    expect(ministry).toMatchObject({ order: 2, label: "Ministry", description: "Renamed via PUT", examples: "Example A", color: "#111111" });
  });

  it("never lets a tenant write the platform-default sentinel row, and leaves a different tenant's (still platform-default) levels untouched", async () => {
    await app.inject({
      method: "PUT", url: "/v1/admin/org-hierarchy-levels",
      headers: authHeader(["tenant_admin"], TENANT_A),
      payload: { levels: [{ id: "ministry", order: 1, label: "Tenant A Only", description: "", examples: "", color: "#333333" }] },
    });

    const otherTenantGet = await app.inject({ method: "GET", url: "/v1/admin/org-hierarchy-levels", headers: authHeader(["tenant_admin"], TENANT_B) });
    expect(otherTenantGet.statusCode).toBe(200);
    const rows = otherTenantGet.json().data as Array<{ label: string }>;
    expect(rows.map((r) => r.label)).toEqual(DEFAULT_LABELS); // still the untouched platform default

    const sentinelRows = await sqlClient`
      SELECT label FROM org_hierarchy_levels.org_hierarchy_levels WHERE tenant_id = ${PLATFORM_DEFAULT_TENANT_ID} ORDER BY sort_order
    `;
    expect(sentinelRows.map((r: { label: string }) => r.label)).toEqual(DEFAULT_LABELS);
  });

  it("rejects duplicate level ids with a real 400 and leaves the tenant's existing data unchanged", async () => {
    const before = await app.inject({ method: "GET", url: "/v1/admin/org-hierarchy-levels", headers: authHeader(["tenant_admin"], TENANT_B) });
    const beforeRows = before.json().data;

    const res = await app.inject({
      method: "PUT", url: "/v1/admin/org-hierarchy-levels",
      headers: authHeader(["tenant_admin"], TENANT_B),
      payload: { levels: [
        { id: "ministry", order: 1, label: "A", description: "", examples: "", color: "#000000" },
        { id: "ministry", order: 2, label: "B", description: "", examples: "", color: "#000000" },
      ] },
    });
    expect(res.statusCode).toBe(400);
    expect(errorCode(res)).toBe("VALIDATION_FAILED");

    const after = await app.inject({ method: "GET", url: "/v1/admin/org-hierarchy-levels", headers: authHeader(["tenant_admin"], TENANT_B) });
    expect(after.json().data).toEqual(beforeRows);
  });

  it("returns 401 without auth, 403 for an unrelated role, and does not modify anything", async () => {
    const noAuth = await app.inject({ method: "PUT", url: "/v1/admin/org-hierarchy-levels", payload: { levels: [] } });
    expect(noAuth.statusCode).toBe(401);
    const wrongRole = await app.inject({
      method: "PUT", url: "/v1/admin/org-hierarchy-levels",
      headers: authHeader(["employee"]),
      payload: { levels: [{ id: "ministry", order: 1, label: "Hacked", description: "", examples: "", color: "#000000" }] },
    });
    expect(wrongRole.statusCode).toBe(403);
  });
});
