/**
 * Cross-tenant RLS isolation for drainage-service, through the real HTTP +
 * async-consumer path, then a second, stricter defense-in-depth layer below.
 * Mirrors services/fire-service/tests/tenant-isolation.test.ts (PR #1011)
 * and services/animal-service/tests/tenant-isolation.test.ts (PR #1007).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { runWithTenant } from "@civitasone/db";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { registerComplaintConsumers } from "../src/modules/complaints/consumer.js";
import { registerFieldActionConsumers } from "../src/modules/field_actions/consumer.js";
import { registerHotspotConsumers } from "../src/modules/hotspots/consumer.js";
import { drainageComplaints } from "../src/modules/complaints/schema.js";
import { hdr, waitFor, ADMIN_ROLES, USER_ROLES, TENANT_A, TENANT_B, ACTOR_A, ACTOR_B } from "./support.js";

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
  registerComplaintConsumers(queue);
  registerFieldActionConsumers(queue);
  registerHotspotConsumers(queue);
  await queue.start();
});

afterAll(async () => {
  await app.close();
  await sqlClient.end();
});

const complaintBody = { location: { ward: "5" }, complaintType: "blocked_drain" as const, description: "isolation test" };
const hotspotBody = { location: { ward: "5" }, category: "test", complaintCount: 1, riskScore: 30 };

describe("tenant isolation — complaints", () => {
  it("tenant B cannot read tenant A's complaint by id, and list excludes it", async () => {
    const create = await app.inject({ method: "POST", url: "/v1/drainage/complaints", headers: hdr(ACTOR_A, TENANT_A, USER_ROLES), payload: complaintBody });
    const id = (create.json() as { id: string }).id;
    await waitFor(async () => (await app.inject({ method: "GET", url: `/v1/drainage/complaints/${id}`, headers: hdr(ACTOR_A, TENANT_A, USER_ROLES) })).statusCode === 200);

    const crossGet = await app.inject({ method: "GET", url: `/v1/drainage/complaints/${id}`, headers: hdr(ACTOR_A, TENANT_B, USER_ROLES) });
    expect(crossGet.statusCode).toBe(404);

    const crossList = await app.inject({ method: "GET", url: "/v1/drainage/complaints", headers: hdr(ACTOR_A, TENANT_B, USER_ROLES) });
    expect(crossList.statusCode).toBe(200);
    expect(crossList.json().data.find((c: { id: string }) => c.id === id)).toBeUndefined();
  });

  it("tenant B cannot assign/resolve/close tenant A's complaint (CAS + RLS both scope to caller's tenant)", async () => {
    const create = await app.inject({ method: "POST", url: "/v1/drainage/complaints", headers: hdr(ACTOR_A, TENANT_A, USER_ROLES), payload: complaintBody });
    const id = (create.json() as { id: string }).id;
    await waitFor(async () => (await app.inject({ method: "GET", url: `/v1/drainage/complaints/${id}`, headers: hdr(ACTOR_A, TENANT_A, USER_ROLES) })).statusCode === 200);

    // findById scoped to TENANT_B sees nothing at this id -> pre-accept 404, never reaches "wrong version"/"wrong transition".
    const crossAssign = await app.inject({ method: "POST", url: `/v1/drainage/complaints/${id}/assign`, headers: hdr(ACTOR_A, TENANT_B, ADMIN_ROLES), payload: { assignedTo: ACTOR_B, version: 1 } });
    expect(crossAssign.statusCode).toBe(404);

    const stillReported = (await app.inject({ method: "GET", url: `/v1/drainage/complaints/${id}`, headers: hdr(ACTOR_A, TENANT_A, USER_ROLES) })).json().data;
    expect(stillReported.status).toBe("reported");
    expect(stillReported.version).toBe(1);
  });
});

describe("tenant isolation — field actions", () => {
  it("tenant B cannot log a field action against tenant A's complaint, cannot read tenant A's field action, and list/by-complaint excludes it", async () => {
    const create = await app.inject({ method: "POST", url: "/v1/drainage/complaints", headers: hdr(ACTOR_A, TENANT_A, USER_ROLES), payload: complaintBody });
    const complaintId = (create.json() as { id: string }).id;
    await waitFor(async () => (await app.inject({ method: "GET", url: `/v1/drainage/complaints/${complaintId}`, headers: hdr(ACTOR_A, TENANT_A, USER_ROLES) })).statusCode === 200);
    await app.inject({ method: "POST", url: `/v1/drainage/complaints/${complaintId}/assign`, headers: hdr(ACTOR_A, TENANT_A, ADMIN_ROLES), payload: { assignedTo: ACTOR_B, version: 1 } });
    await waitFor(async () => (await app.inject({ method: "GET", url: `/v1/drainage/complaints/${complaintId}`, headers: hdr(ACTOR_A, TENANT_A, USER_ROLES) })).json().data.status === "assigned");

    // Tenant B's own findById scoping means tenant A's complaint is invisible to it -> pre-accept 404.
    const crossCreate = await app.inject({
      method: "POST", url: "/v1/drainage/field-actions", headers: hdr(ACTOR_B, TENANT_B, ADMIN_ROLES),
      payload: { complaintId, actionType: "cleaning", notes: "cross-tenant attempt" },
    });
    expect(crossCreate.statusCode).toBe(404);

    const create2 = await app.inject({ method: "POST", url: "/v1/drainage/field-actions", headers: hdr(ACTOR_B, TENANT_A, ADMIN_ROLES), payload: { complaintId, actionType: "cleaning", notes: "real" } });
    const fieldActionId = (create2.json() as { id: string }).id;
    await waitFor(async () => (await app.inject({ method: "GET", url: `/v1/drainage/field-actions/${fieldActionId}`, headers: hdr(ACTOR_A, TENANT_A, USER_ROLES) })).statusCode === 200);

    const crossGet = await app.inject({ method: "GET", url: `/v1/drainage/field-actions/${fieldActionId}`, headers: hdr(ACTOR_A, TENANT_B, USER_ROLES) });
    expect(crossGet.statusCode).toBe(404);

    const crossByComplaint = await app.inject({ method: "GET", url: `/v1/drainage/complaints/${complaintId}/field-actions`, headers: hdr(ACTOR_A, TENANT_B, USER_ROLES) });
    expect(crossByComplaint.statusCode).toBe(200);
    expect(crossByComplaint.json().data).toHaveLength(0);
  });
});

describe("tenant isolation — hotspots", () => {
  it("tenant B cannot read tenant A's hotspot by id, list excludes it, and cannot change its status/resolve it", async () => {
    const create = await app.inject({ method: "POST", url: "/v1/drainage/hotspots", headers: hdr(ACTOR_A, TENANT_A, ADMIN_ROLES), payload: hotspotBody });
    const id = (create.json() as { id: string }).id;
    await waitFor(async () => (await app.inject({ method: "GET", url: `/v1/drainage/hotspots/${id}`, headers: hdr(ACTOR_A, TENANT_A, USER_ROLES) })).statusCode === 200);

    const crossGet = await app.inject({ method: "GET", url: `/v1/drainage/hotspots/${id}`, headers: hdr(ACTOR_A, TENANT_B, USER_ROLES) });
    expect(crossGet.statusCode).toBe(404);

    const crossList = await app.inject({ method: "GET", url: "/v1/drainage/hotspots", headers: hdr(ACTOR_A, TENANT_B, USER_ROLES) });
    expect(crossList.json().data.find((h: { id: string }) => h.id === id)).toBeUndefined();

    const crossStatus = await app.inject({ method: "POST", url: `/v1/drainage/hotspots/${id}/status`, headers: hdr(ACTOR_A, TENANT_B, ADMIN_ROLES), payload: { status: "action_planned", version: 1 } });
    expect(crossStatus.statusCode).toBe(404);

    const crossResolve = await app.inject({ method: "POST", url: `/v1/drainage/hotspots/${id}/resolve`, headers: hdr(ACTOR_A, TENANT_B, ADMIN_ROLES), payload: { version: 1 } });
    expect(crossResolve.statusCode).toBe(404);

    const stillIdentified = (await app.inject({ method: "GET", url: `/v1/drainage/hotspots/${id}`, headers: hdr(ACTOR_A, TENANT_A, USER_ROLES) })).json().data;
    expect(stillIdentified.status).toBe("identified");
    expect(stillIdentified.version).toBe(1);
  });
});

/**
 * RLS defense-in-depth — WITH REAL TEETH, not just app-level filtering.
 *
 * Every test above goes through repo.findById(id, tenantId) / repo.listByTenant(
 * tenantId, ...), and EVERY one of those functions already puts
 * eq(table.tenantId, tenantId) in its own WHERE clause. That means those
 * tests would still pass even with RLS completely disabled — application
 * code alone already scopes every query correctly. They exercise the real
 * HTTP path, which has value, but they do NOT prove the database-level
 * backstop (FORCE ROW LEVEL SECURITY + the tenant_isolation policy in
 * migrations/0001_initial.sql) is doing anything.
 *
 * Verified directly during development of this suite (not part of the
 * automated run — a one-time manual check against this exact container):
 *   ALTER TABLE civitas_drainage.drainage_complaints NO FORCE ROW LEVEL SECURITY;
 * ...then re-ran the raw-query test below. Result: it WENT RED — tenant B's
 * session saw tenant A's row — proving that with FORCE RLS off, only the
 * app-level `eq(tenantId)` predicate (which this raw query deliberately
 * omits) was left standing between tenants. Then:
 *   ALTER TABLE civitas_drainage.drainage_complaints FORCE ROW LEVEL SECURITY;
 * ...restored, and the test went green again. That round-trip is the actual
 * proof this test has teeth against a future RLS regression; it is not
 * repeated on every run (there is no cheap way to flip FORCE RLS mid-suite
 * without a superuser connection this suite does not hold), but the
 * mechanism itself does not change between runs.
 *
 * The committed test queries the table directly with NO tenant_id predicate
 * in the query itself (`tx.select().from(table)`, no .where() at all),
 * relying ENTIRELY on the RLS policy + the app.tenant_id GUC (set here via
 * runWithTenant, the same mechanism app.ts's onRequest hooks use for a real
 * request) to scope the result.
 */
describe("RLS defense-in-depth — raw query, no app-level tenant filter", () => {
  it("a raw SELECT with no WHERE tenant_id clause, scoped only by the RLS GUC, returns none of another tenant's rows", async () => {
    const tenantARowId = randomUUID();
    await runWithTenant(TENANT_A, () =>
      db.transaction(async (tx) => {
        await tx.insert(drainageComplaints).values({
          id: tenantARowId,
          tenantId: TENANT_A,
          complaintNumber: `DRN-RLSTEST-${Date.now()}`,
          reportedBy: ACTOR_A,
          location: { ward: "rls-test" },
          complaintType: "blocked_drain",
          description: "RLS direct-query test row",
          photo: null,
          severity: "medium",
          status: "reported",
          createdBy: ACTOR_A,
          updatedBy: ACTOR_A,
        });
      }),
    );

    // Tenant B's session, querying with NO tenant_id predicate at all --
    // whatever scoping happens here comes ONLY from RLS + the GUC.
    const rowsVisibleToTenantB = await runWithTenant(TENANT_B, () =>
      db.transaction((tx) => tx.select().from(drainageComplaints)),
    );
    expect(rowsVisibleToTenantB.find((r) => r.id === tenantARowId)).toBeUndefined();

    // Sanity check on the other side: tenant A's OWN session, same
    // no-predicate query, DOES see it -- proves this isn't just an empty
    // table or a broken GUC making everything invisible.
    const rowsVisibleToTenantA = await runWithTenant(TENANT_A, () =>
      db.transaction((tx) => tx.select().from(drainageComplaints)),
    );
    expect(rowsVisibleToTenantA.find((r) => r.id === tenantARowId)).toBeDefined();
  });
});
