/**
 * SVC-130 — cross-tenant RLS isolation for the change/release module.
 *
 * Tenant A raises a change; Tenant B must never see it in a list, read it by id,
 * or drive its state machine. Enforced by Postgres RLS (migration 0013), not
 * merely an app-layer WHERE.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT_A = "aaaaaaaa-eeee-4000-8000-000000000001";
const TENANT_B = "bbbbbbbb-eeee-4000-8000-000000000002";
const ACTOR_A = "aaaaaaaa-eeee-4000-8000-aaaaaaaaaaaa";
const ACTOR_B = "bbbbbbbb-eeee-4000-8000-bbbbbbbbbbbb";

function tokenFor(tenantId: string, actorId: string): string {
  return signToken({ sub: actorId, tid: tenantId, roles: ["tenant_admin", "super_admin"], sid: "sess-rls-chg" }, SECRET, 3600);
}
function hdr(tenantId: string, actorId: string) {
  return { authorization: `Bearer ${tokenFor(tenantId, actorId)}` };
}

let app: FastifyInstance;
let changeId: string;

beforeAll(async () => {
  app = await buildApp();
  const res = await app.inject({
    method: "POST", url: "/v1/admin/change/requests", headers: hdr(TENANT_A, ACTOR_A),
    payload: {
      title: "Tenant A only change", type: "standard", risk: "low",
      affectedServices: ["admin-service"], description: "Isolation probe change request.",
      rollbackPlan: "No-op; revert config.",
    },
  });
  expect(res.statusCode).toBe(201);
  changeId = res.json().id;
});
afterAll(async () => { await app.close(); await sqlClient.end(); });

describe("Change — Cross-Tenant RLS Isolation", () => {
  it("Tenant B list never contains Tenant A's change", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/admin/change/requests", headers: hdr(TENANT_B, ACTOR_B) });
    expect(res.statusCode).toBe(200);
    const data = res.json().data as Array<{ id: string }>;
    expect(data.find((c) => c.id === changeId)).toBeUndefined();
  });

  it("Tenant B GET by id returns 404 (not another tenant's row)", async () => {
    const res = await app.inject({ method: "GET", url: `/v1/admin/change/requests/${changeId}`, headers: hdr(TENANT_B, ACTOR_B) });
    expect(res.statusCode).toBe(404);
  });

  it("Tenant B cannot submit Tenant A's change (404 under RLS)", async () => {
    const res = await app.inject({ method: "POST", url: `/v1/admin/change/requests/${changeId}/submit`, headers: hdr(TENANT_B, ACTOR_B) });
    expect(res.statusCode).toBe(404);
  });

  it("Tenant A still sees and can drive its own change", async () => {
    const res = await app.inject({ method: "GET", url: `/v1/admin/change/requests/${changeId}`, headers: hdr(TENANT_A, ACTOR_A) });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.id).toBe(changeId);
  });

  it("the persisted row carries Tenant A's tenant_id only", async () => {
    // Read with Tenant A's GUC set on the connection so RLS admits the row;
    // proves it persisted, and (below) that Tenant B's GUC cannot see it.
    const rows = await sqlClient.begin(async (sql) => {
      await sql`SELECT set_config('app.tenant_id', ${TENANT_A}, true)`;
      return sql`SELECT tenant_id FROM change.change_requests WHERE id = ${changeId}`;
    });
    expect(rows.length).toBe(1);
    expect(rows[0].tenant_id).toBe(TENANT_A);

    // Same query under Tenant B's GUC is filtered to zero rows by RLS.
    const asB = await sqlClient.begin(async (sql) => {
      await sql`SELECT set_config('app.tenant_id', ${TENANT_B}, true)`;
      return sql`SELECT tenant_id FROM change.change_requests WHERE id = ${changeId}`;
    });
    expect(asB.length).toBe(0);
  });
});
