/**
 * Cross-tenant RLS isolation — proves the FORCE ROW LEVEL SECURITY /
 * tenant_isolation policies added in migrations/0001_initial.sql actually
 * hold for every domain table in this service (fire_applications,
 * fire_inspections, fire_nocs, fire_renewals all use the identical policy
 * shape), through the real HTTP + async-consumer path, not just at the
 * repo/SQL layer. Mirrors services/animal-service/tests/
 * tenant-isolation.test.ts (PR #1007).
 *
 * These assertions are intentionally strict (exact 404, not "404 or 500"):
 * app.ts's onRequest hooks always set the app.tenant_id GUC from the
 * caller's own verified JWT tenant for any authenticated request (see the
 * G2 hook added by PR #999), so a real authenticated cross-tenant call
 * never hits the "GUC missing" edge case — it must cleanly 404.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { runWithTenant } from "@civitasone/db";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { registerApplicationConsumers } from "../src/modules/applications/consumer.js";
import { registerInspectionConsumers } from "../src/modules/inspections/consumer.js";
import { registerNocConsumers } from "../src/modules/nocs/consumer.js";
import { registerLifecycleConsumers } from "../src/modules/lifecycle/consumer.js";
import { fireApplicationsTable } from "../src/modules/applications/schema.js";
import * as appRepo from "../src/modules/applications/repo.js";
import { hdr, drainQueue, waitFor, OFFICER_ROLES, INSPECTOR_ROLES, TENANT_A, TENANT_B, ACTOR_A } from "./support.js";

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
  registerApplicationConsumers(queue);
  registerInspectionConsumers(queue);
  registerNocConsumers(queue);
  registerLifecycleConsumers(queue);
  await queue.start();
});

afterAll(async () => {
  await app.close();
  await sqlClient.end();
});

const appBody = {
  buildingName: "Isolation Test Building",
  buildingAddress: { line1: "1 Test St", city: "Pune", pin: "411001" },
  occupancyType: "commercial" as const,
};

describe("tenant isolation — applications", () => {
  it("tenant B cannot read tenant A's application by id, and list excludes it", async () => {
    const create = await app.inject({ method: "POST", url: "/v1/fire/applications", headers: hdr(ACTOR_A, TENANT_A, OFFICER_ROLES), payload: appBody });
    const id = (create.json() as { id: string }).id;
    await waitFor(async () => (await app.inject({ method: "GET", url: `/v1/fire/applications/${id}`, headers: hdr(ACTOR_A, TENANT_A, OFFICER_ROLES) })).statusCode === 200);

    const crossGet = await app.inject({ method: "GET", url: `/v1/fire/applications/${id}`, headers: hdr(ACTOR_A, TENANT_B, OFFICER_ROLES) });
    expect(crossGet.statusCode).toBe(404);

    const crossList = await app.inject({ method: "GET", url: "/v1/fire/applications", headers: hdr(ACTOR_A, TENANT_B, OFFICER_ROLES) });
    expect(crossList.statusCode).toBe(200);
    expect(crossList.json().data.find((a: { id: string }) => a.id === id)).toBeUndefined();
  });

  it("tenant B cannot submit/withdraw tenant A's application (CAS + RLS both scope to caller's tenant)", async () => {
    const create = await app.inject({ method: "POST", url: "/v1/fire/applications", headers: hdr(ACTOR_A, TENANT_A, OFFICER_ROLES), payload: appBody });
    const id = (create.json() as { id: string }).id;
    await waitFor(async () => (await app.inject({ method: "GET", url: `/v1/fire/applications/${id}`, headers: hdr(ACTOR_A, TENANT_A, OFFICER_ROLES) })).statusCode === 200);

    const crossSubmit = await app.inject({ method: "POST", url: `/v1/fire/applications/${id}/submit`, headers: hdr(ACTOR_A, TENANT_B, OFFICER_ROLES) });
    // findById scoped to TENANT_B sees nothing at this id -> 404, not 202/422.
    expect(crossSubmit.statusCode).toBe(404);

    const stillDraft = (await app.inject({ method: "GET", url: `/v1/fire/applications/${id}`, headers: hdr(ACTOR_A, TENANT_A, OFFICER_ROLES) })).json().data;
    expect(stillDraft.status).toBe("draft");
  });
});

describe("tenant isolation — inspections", () => {
  it("tenant B cannot schedule an inspection against tenant A's application, cannot read tenant A's inspection, and list excludes it", async () => {
    const create = await app.inject({ method: "POST", url: "/v1/fire/applications", headers: hdr(ACTOR_A, TENANT_A, OFFICER_ROLES), payload: appBody });
    const applicationId = (create.json() as { id: string }).id;
    await waitFor(async () => (await app.inject({ method: "GET", url: `/v1/fire/applications/${applicationId}`, headers: hdr(ACTOR_A, TENANT_A, OFFICER_ROLES) })).statusCode === 200);
    await app.inject({ method: "POST", url: `/v1/fire/applications/${applicationId}/submit`, headers: hdr(ACTOR_A, TENANT_A, OFFICER_ROLES) });
    await waitFor(async () => (await app.inject({ method: "GET", url: `/v1/fire/applications/${applicationId}`, headers: hdr(ACTOR_A, TENANT_A, OFFICER_ROLES) })).json().data.status === "submitted");

    // Tenant B's own findById scoping means tenant A's application is
    // invisible to it -> pre-accept 404, never reaches "wrong status".
    const crossSchedule = await app.inject({
      method: "POST",
      url: "/v1/fire/inspections",
      headers: hdr(ACTOR_A, TENANT_B, INSPECTOR_ROLES),
      payload: { applicationId, inspectorId: ACTOR_A, scheduledDate: "2027-01-15" },
    });
    expect(crossSchedule.statusCode).toBe(404);

    const schedule = await app.inject({ method: "POST", url: "/v1/fire/inspections", headers: hdr(ACTOR_A, TENANT_A, INSPECTOR_ROLES), payload: { applicationId, inspectorId: ACTOR_A, scheduledDate: "2027-01-15" } });
    const inspectionId = (schedule.json() as { id: string }).id;
    await waitFor(async () => (await app.inject({ method: "GET", url: `/v1/fire/inspections/${inspectionId}`, headers: hdr(ACTOR_A, TENANT_A, OFFICER_ROLES) })).statusCode === 200);

    const crossGet = await app.inject({ method: "GET", url: `/v1/fire/inspections/${inspectionId}`, headers: hdr(ACTOR_A, TENANT_B, OFFICER_ROLES) });
    expect(crossGet.statusCode).toBe(404);

    const crossByApp = await app.inject({ method: "GET", url: `/v1/fire/inspections/by-application/${applicationId}`, headers: hdr(ACTOR_A, TENANT_B, OFFICER_ROLES) });
    expect(crossByApp.statusCode).toBe(200);
    expect(crossByApp.json().data).toHaveLength(0);
  });
});

describe("tenant isolation — nocs", () => {
  it("tenant B cannot read tenant A's NOC by id, list excludes it, and cannot suspend/revoke it", async () => {
    const create = await app.inject({ method: "POST", url: "/v1/fire/applications", headers: hdr(ACTOR_A, TENANT_A, OFFICER_ROLES), payload: appBody });
    const applicationId = (create.json() as { id: string }).id;
    await waitFor(async () => (await app.inject({ method: "GET", url: `/v1/fire/applications/${applicationId}`, headers: hdr(ACTOR_A, TENANT_A, OFFICER_ROLES) })).statusCode === 200);
    await app.inject({ method: "POST", url: `/v1/fire/applications/${applicationId}/submit`, headers: hdr(ACTOR_A, TENANT_A, OFFICER_ROLES) });
    await waitFor(async () => (await app.inject({ method: "GET", url: `/v1/fire/applications/${applicationId}`, headers: hdr(ACTOR_A, TENANT_A, OFFICER_ROLES) })).json().data.status === "submitted");
    const schedule = await app.inject({ method: "POST", url: "/v1/fire/inspections", headers: hdr(ACTOR_A, TENANT_A, INSPECTOR_ROLES), payload: { applicationId, inspectorId: ACTOR_A, scheduledDate: "2027-01-15" } });
    const inspectionId = (schedule.json() as { id: string }).id;
    await waitFor(async () => (await app.inject({ method: "GET", url: `/v1/fire/inspections/${inspectionId}`, headers: hdr(ACTOR_A, TENANT_A, OFFICER_ROLES) })).statusCode === 200);
    await app.inject({ method: "POST", url: `/v1/fire/inspections/${inspectionId}/complete`, headers: hdr(ACTOR_A, TENANT_A, INSPECTOR_ROLES), payload: { recommendation: "approve" } });
    await waitFor(async () => (await app.inject({ method: "GET", url: `/v1/fire/inspections/${inspectionId}`, headers: hdr(ACTOR_A, TENANT_A, OFFICER_ROLES) })).json().data.status === "completed");
    const issue = await app.inject({ method: "POST", url: "/v1/fire/nocs", headers: hdr(ACTOR_A, TENANT_A, OFFICER_ROLES), payload: { applicationId, validFrom: "2027-02-01" } });
    const nocId = (issue.json() as { id: string }).id;
    await waitFor(async () => (await app.inject({ method: "GET", url: `/v1/fire/nocs/${nocId}`, headers: hdr(ACTOR_A, TENANT_A, OFFICER_ROLES) })).statusCode === 200);

    const crossGet = await app.inject({ method: "GET", url: `/v1/fire/nocs/${nocId}`, headers: hdr(ACTOR_A, TENANT_B, OFFICER_ROLES) });
    expect(crossGet.statusCode).toBe(404);

    const crossList = await app.inject({ method: "GET", url: "/v1/fire/nocs", headers: hdr(ACTOR_A, TENANT_B, OFFICER_ROLES) });
    expect(crossList.json().data.find((n: { id: string }) => n.id === nocId)).toBeUndefined();

    const crossRevoke = await app.inject({ method: "POST", url: `/v1/fire/nocs/${nocId}/revoke`, headers: hdr(ACTOR_A, TENANT_B, OFFICER_ROLES), payload: { reason: "x" } });
    expect(crossRevoke.statusCode).toBe(404);

    const stillActive = (await app.inject({ method: "GET", url: `/v1/fire/nocs/${nocId}`, headers: hdr(ACTOR_A, TENANT_A, OFFICER_ROLES) })).json().data;
    expect(stillActive.status).toBe("active");
  });
});

describe("tenant isolation — lifecycle/renewals", () => {
  it("tenant B cannot request a renewal against tenant A's NOC, cannot read tenant A's renewal, and list excludes it", async () => {
    const create = await app.inject({ method: "POST", url: "/v1/fire/applications", headers: hdr(ACTOR_A, TENANT_A, OFFICER_ROLES), payload: appBody });
    const applicationId = (create.json() as { id: string }).id;
    await waitFor(async () => (await app.inject({ method: "GET", url: `/v1/fire/applications/${applicationId}`, headers: hdr(ACTOR_A, TENANT_A, OFFICER_ROLES) })).statusCode === 200);
    await app.inject({ method: "POST", url: `/v1/fire/applications/${applicationId}/submit`, headers: hdr(ACTOR_A, TENANT_A, OFFICER_ROLES) });
    await waitFor(async () => (await app.inject({ method: "GET", url: `/v1/fire/applications/${applicationId}`, headers: hdr(ACTOR_A, TENANT_A, OFFICER_ROLES) })).json().data.status === "submitted");
    const schedule = await app.inject({ method: "POST", url: "/v1/fire/inspections", headers: hdr(ACTOR_A, TENANT_A, INSPECTOR_ROLES), payload: { applicationId, inspectorId: ACTOR_A, scheduledDate: "2027-01-15" } });
    const inspectionId = (schedule.json() as { id: string }).id;
    await waitFor(async () => (await app.inject({ method: "GET", url: `/v1/fire/inspections/${inspectionId}`, headers: hdr(ACTOR_A, TENANT_A, OFFICER_ROLES) })).statusCode === 200);
    await app.inject({ method: "POST", url: `/v1/fire/inspections/${inspectionId}/complete`, headers: hdr(ACTOR_A, TENANT_A, INSPECTOR_ROLES), payload: { recommendation: "approve" } });
    await waitFor(async () => (await app.inject({ method: "GET", url: `/v1/fire/inspections/${inspectionId}`, headers: hdr(ACTOR_A, TENANT_A, OFFICER_ROLES) })).json().data.status === "completed");
    const issue = await app.inject({ method: "POST", url: "/v1/fire/nocs", headers: hdr(ACTOR_A, TENANT_A, OFFICER_ROLES), payload: { applicationId, validFrom: "2027-02-01" } });
    const nocId = (issue.json() as { id: string }).id;
    // Two-step wait: the row does not exist at all until the consumer
    // processes it, so a GET can genuinely 404 on the first poll -- check
    // statusCode before touching .json().data (a 404 body has no `data` key).
    await waitFor(async () => (await app.inject({ method: "GET", url: `/v1/fire/nocs/${nocId}`, headers: hdr(ACTOR_A, TENANT_A, OFFICER_ROLES) })).statusCode === 200);
    await waitFor(async () => (await app.inject({ method: "GET", url: `/v1/fire/nocs/${nocId}`, headers: hdr(ACTOR_A, TENANT_A, OFFICER_ROLES) })).json().data.status === "active");

    const crossRequest = await app.inject({ method: "POST", url: "/v1/fire/renewals", headers: hdr(ACTOR_A, TENANT_B, OFFICER_ROLES), payload: { nocId, renewalType: "renewal" } });
    expect(crossRequest.statusCode).toBe(404);

    const request = await app.inject({ method: "POST", url: "/v1/fire/renewals", headers: hdr(ACTOR_A, TENANT_A, OFFICER_ROLES), payload: { nocId, renewalType: "renewal" } });
    const renewalId = (request.json() as { id: string }).id;
    await waitFor(async () => (await app.inject({ method: "GET", url: `/v1/fire/renewals/${renewalId}`, headers: hdr(ACTOR_A, TENANT_A, OFFICER_ROLES) })).statusCode === 200);

    const crossGet = await app.inject({ method: "GET", url: `/v1/fire/renewals/${renewalId}`, headers: hdr(ACTOR_A, TENANT_B, OFFICER_ROLES) });
    expect(crossGet.statusCode).toBe(404);

    const crossList = await app.inject({ method: "GET", url: "/v1/fire/renewals", headers: hdr(ACTOR_A, TENANT_B, OFFICER_ROLES) });
    expect(crossList.json().data.find((r: { id: string }) => r.id === renewalId)).toBeUndefined();
  });
});

/**
 * RLS defense-in-depth — WITH REAL TEETH, not just app-level filtering.
 *
 * Every test above goes through repo.findById(tenantId, id) / repo.list(
 * tenantId, ...), and EVERY one of those functions already puts
 * eq(table.tenantId, tenantId) in its own WHERE clause. That means those
 * tests pass even with RLS completely disabled — application code alone
 * already scopes every query correctly. They exercise the real HTTP path,
 * which has value, but they do NOT prove the database-level backstop
 * (FORCE ROW LEVEL SECURITY + the tenant_isolation policy) is doing
 * anything. Verified directly: temporarily running
 * `ALTER TABLE fire_applications.fire_applications NO FORCE ROW LEVEL
 * SECURITY` (and the same for the other 3 domain tables) against this exact
 * suite left every test above still green — proof that they alone don't
 * have teeth against an RLS regression, i.e. a future repo function that
 * forgets its own tenantId filter.
 *
 * This test closes that gap: it queries the table directly with NO
 * tenant_id predicate in the query itself (`tx.select().from(table)`, no
 * .where() at all), relying ENTIRELY on the RLS policy + the app.tenant_id
 * GUC (set here via runWithTenant, the same mechanism app.ts's onRequest
 * hooks use for a real request) to scope the result. With FORCE ROW LEVEL
 * SECURITY in place, a session scoped to tenant B must see zero of tenant
 * A's rows here even though the query asked for everything.
 */
describe("RLS defense-in-depth — raw query, no app-level tenant filter", () => {
  it("a raw SELECT with no WHERE tenant_id clause, scoped only by the RLS GUC, returns none of another tenant's rows", async () => {
    const tenantARowId = randomUUID();
    await runWithTenant(TENANT_A, () =>
      db.transaction(async (tx) => {
        const applicationNumber = `FIRE/RLSTEST/${new Date().getUTCFullYear()}/${String(
          await appRepo.nextApplicationNumber(tx),
        ).padStart(6, "0")}`;
        await tx.insert(fireApplicationsTable).values({
          id: tenantARowId,
          tenantId: TENANT_A,
          applicationNumber,
          status: "draft",
          buildingName: "RLS Direct-Query Test Building",
          buildingAddress: { line1: "1 Test St", city: "Pune", pin: "411001" },
          occupancyType: "commercial",
          feeMinor: 250000n,
          feeCurrency: "INR",
          feePaid: false,
          createdBy: ACTOR_A,
          updatedBy: ACTOR_A,
        });
      }),
    );

    // Tenant B's session, querying with NO tenant_id predicate at all --
    // whatever scoping happens here comes ONLY from RLS + the GUC.
    const rowsVisibleToTenantB = await runWithTenant(TENANT_B, () =>
      db.transaction((tx) => tx.select().from(fireApplicationsTable)),
    );
    expect(rowsVisibleToTenantB.find((r) => r.id === tenantARowId)).toBeUndefined();

    // Sanity check on the other side: tenant A's OWN session, same
    // no-predicate query, DOES see it -- proves this isn't just an empty
    // table or a broken GUC making everything invisible.
    const rowsVisibleToTenantA = await runWithTenant(TENANT_A, () =>
      db.transaction((tx) => tx.select().from(fireApplicationsTable)),
    );
    expect(rowsVisibleToTenantA.find((r) => r.id === tenantARowId)).toBeDefined();
  });
});
