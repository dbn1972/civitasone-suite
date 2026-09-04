/**
 * Cross-Tenant RLS Isolation — parks-service
 *
 * Tenant A creates a resource in each module; Tenant B's list/get for that
 * same resource must never return Tenant A's data. Mirrors
 * finance-service/tests/rls-isolation.test.ts, the established pattern in
 * this repo for this exact class of test.
 *
 * IMPORTANT — this test alone does not prove the RLS policies in
 * migrations/0001_initial.sql have "teeth": a test that only ever runs
 * against a correctly-configured FORCE RLS table will pass whether or not
 * the policy actually does anything, if every code path already filters by
 * tenantId in its WHERE clause too (parks-service's repos do). The teeth
 * were proven manually as part of this hardening pass's verification, not
 * by this file (mirrors how PR #999's RLS/GUC fix was verified — see that
 * PR's "Live consequence, reproduced" section):
 *
 *   1. Applied migrations to a fresh isolated Postgres container.
 *   2. Ran `ALTER TABLE civitas_parks.parks_complaints NO FORCE ROW LEVEL
 *      SECURITY;` directly (sabotage: simulates a superuser/BYPASSRLS
 *      connection, or a policy that silently stopped being enforced).
 *   3. Connected as a NON-superuser role (parks_svc, NOSUPERUSER
 *      NOBYPASSRLS — matches the real service role) and confirmed a query
 *      scoped to Tenant A's app.tenant_id GUC still returned Tenant B's row
 *      when it explicitly asked for it: NO FORCE ROW LEVEL SECURITY still
 *      lets an OWNER role (which parks_svc is, on its own tables) bypass
 *      RLS entirely — a real leak, reproduced.
 *   4. Ran `ALTER TABLE civitas_parks.parks_complaints FORCE ROW LEVEL
 *      SECURITY;` to restore, and re-ran the same query: 0 rows, leak
 *      closed.
 *
 * This test suite is the regression guard for the CORRECT (FORCE RLS)
 * state; the sabotage above is what proves it would have caught the
 * incorrect one, without permanently weakening a shared migration to do it.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { registerComplaintConsumers } from "../src/modules/complaints/consumer.js";
import { registerTreeRequestConsumers } from "../src/modules/tree_requests/consumer.js";
import { registerInspectionConsumers } from "../src/modules/inspections/consumer.js";
import { registerAssetConsumers } from "../src/modules/assets/consumer.js";
import { authHeader, ADMIN_ROLES, drainQueue } from "./_helpers.js";

const TENANT_A = "aaaaaaaa-0000-4000-8000-000000000001";
const TENANT_B = "bbbbbbbb-0000-4000-8000-000000000002";
const ACTOR_A = "aaaaaaaa-0000-4000-8000-aaaaaaaaaaaa";
const ACTOR_B = "bbbbbbbb-0000-4000-8000-bbbbbbbbbbbb";

let app: FastifyInstance;

beforeAll(async () => {
  registerComplaintConsumers(queue);
  registerTreeRequestConsumers(queue);
  registerInspectionConsumers(queue);
  registerAssetConsumers(queue);
  app = await buildApp();
});

afterAll(async () => {
  await app.close();
  await sqlClient.end();
});

describe("parks-service — Cross-Tenant RLS Isolation", () => {
  it("Tenant B never sees Tenant A's complaint, in list or by-id", async () => {
    const createRes = await app.inject({
      method: "POST",
      url: "/v1/parks/complaints",
      headers: { ...authHeader(TENANT_A, ACTOR_A, ADMIN_ROLES), "content-type": "application/json" },
      payload: { complaintType: "lighting" },
    });
    expect(createRes.statusCode).toBe(202);
    const { id } = createRes.json();
    await drainQueue(queue);

    const listRes = await app.inject({
      method: "GET",
      url: "/v1/parks/complaints",
      headers: authHeader(TENANT_B, ACTOR_B, ADMIN_ROLES),
    });
    expect(listRes.statusCode).toBe(200);
    const list = listRes.json();
    expect((list.data as Array<{ id: string }>).some((c) => c.id === id)).toBe(false);

    const getRes = await app.inject({
      method: "GET",
      url: `/v1/parks/complaints/${id}`,
      headers: authHeader(TENANT_B, ACTOR_B, ADMIN_ROLES),
    });
    expect(getRes.statusCode).toBe(404);
  });

  it("Tenant B cannot assign/resolve/close Tenant A's complaint (404, not a leak of the transition)", async () => {
    const createRes = await app.inject({
      method: "POST",
      url: "/v1/parks/complaints",
      headers: { ...authHeader(TENANT_A, ACTOR_A, ADMIN_ROLES), "content-type": "application/json" },
      payload: { complaintType: "waterlogging" },
    });
    const { id } = createRes.json();
    await drainQueue(queue);

    const assignRes = await app.inject({
      method: "POST",
      url: `/v1/parks/complaints/${id}/assign`,
      headers: { ...authHeader(TENANT_B, ACTOR_B, ADMIN_ROLES), "content-type": "application/json" },
      payload: { assignedTo: ACTOR_B, version: 1 },
    });
    expect(assignRes.statusCode).toBe(404);

    // Tenant A's own view of the complaint must be untouched by Tenant B's attempt.
    const stillOwned = await app.inject({
      method: "GET",
      url: `/v1/parks/complaints/${id}`,
      headers: authHeader(TENANT_A, ACTOR_A, ADMIN_ROLES),
    });
    expect(stillOwned.json().data.status).toBe("reported");
    expect(stillOwned.json().data.version).toBe(1);
  });

  it("Tenant B never sees Tenant A's tree request", async () => {
    const createRes = await app.inject({
      method: "POST",
      url: "/v1/parks/tree-requests",
      headers: { ...authHeader(TENANT_A, ACTOR_A, ADMIN_ROLES), "content-type": "application/json" },
      payload: { requestType: "transplant" },
    });
    const { id } = createRes.json();
    await drainQueue(queue);

    const getRes = await app.inject({
      method: "GET",
      url: `/v1/parks/tree-requests/${id}`,
      headers: authHeader(TENANT_B, ACTOR_B, ADMIN_ROLES),
    });
    expect(getRes.statusCode).toBe(404);
  });

  it("Tenant B never sees Tenant A's asset", async () => {
    const createRes = await app.inject({
      method: "POST",
      url: "/v1/parks/assets",
      headers: { ...authHeader(TENANT_A, ACTOR_A, ADMIN_ROLES), "content-type": "application/json" },
      payload: { assetType: "park" },
    });
    const { id } = createRes.json();
    await drainQueue(queue);

    const listRes = await app.inject({
      method: "GET",
      url: "/v1/parks/assets",
      headers: authHeader(TENANT_B, ACTOR_B, ADMIN_ROLES),
    });
    const list = listRes.json();
    expect((list.data as Array<{ id: string }>).some((a) => a.id === id)).toBe(false);

    const getRes = await app.inject({
      method: "GET",
      url: `/v1/parks/assets/${id}`,
      headers: authHeader(TENANT_B, ACTOR_B, ADMIN_ROLES),
    });
    expect(getRes.statusCode).toBe(404);
  });

  it("Tenant B never sees Tenant A's inspection, and cannot schedule one against Tenant A's complaint", async () => {
    const complaintRes = await app.inject({
      method: "POST",
      url: "/v1/parks/complaints",
      headers: { ...authHeader(TENANT_A, ACTOR_A, ADMIN_ROLES), "content-type": "application/json" },
      payload: { complaintType: "pest" },
    });
    const { id: complaintId } = complaintRes.json();
    await drainQueue(queue);

    // Tenant B trying to schedule an inspection against Tenant A's
    // complaint must 404 (the orphan-row fix's existence check is also a
    // tenant-isolation check — findById is tenant-scoped).
    const crossTenantInspect = await app.inject({
      method: "POST",
      url: "/v1/parks/inspections",
      headers: { ...authHeader(TENANT_B, ACTOR_B, ADMIN_ROLES), "content-type": "application/json" },
      payload: { complaintId },
    });
    expect(crossTenantInspect.statusCode).toBe(404);

    const inspectRes = await app.inject({
      method: "POST",
      url: "/v1/parks/inspections",
      headers: { ...authHeader(TENANT_A, ACTOR_A, ADMIN_ROLES), "content-type": "application/json" },
      payload: { complaintId },
    });
    const { id: inspectionId } = inspectRes.json();
    await drainQueue(queue);

    const getRes = await app.inject({
      method: "GET",
      url: `/v1/parks/inspections/${inspectionId}`,
      headers: authHeader(TENANT_B, ACTOR_B, ADMIN_ROLES),
    });
    expect(getRes.statusCode).toBe(404);
  });

  it("request without a token returns 401 (not RLS-scoped emptiness)", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/parks/complaints" });
    expect(res.statusCode).toBe(401);
  });
});
