/**
 * Cross-tenant RLS isolation — proves the FORCE ROW LEVEL SECURITY /
 * tenant_isolation policies added in migrations/0001_initial.sql actually
 * hold for every domain table in this service (roadcut_applications,
 * roadcut_permits, roadcut_inspections, roadcut_restorations all use the
 * identical policy shape), through the real HTTP + async-consumer path, not
 * just at the repo/SQL layer. Mirrors services/fire-service/tests/
 * tenant-isolation.test.ts (PR #1011) and services/animal-service/tests/
 * tenant-isolation.test.ts (PR #1007).
 *
 * These assertions are intentionally strict (exact 404, not "404 or 500"):
 * app.ts's onRequest hooks always set the app.tenant_id GUC from the
 * caller's own verified JWT tenant for any authenticated request (the G2
 * hook, matching admin-service / hrms-service / payroll-service), so a real
 * authenticated cross-tenant call never hits the "GUC missing" edge case —
 * it must cleanly 404.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { runWithTenant } from "@civitasone/db";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { registerApplicationConsumers } from "../src/modules/applications/consumer.js";
import { registerPermitConsumers } from "../src/modules/permits/consumer.js";
import { registerInspectionConsumers } from "../src/modules/inspections/consumer.js";
import { registerRestorationConsumers } from "../src/modules/restoration/consumer.js";
import { roadcutApplications } from "../src/modules/applications/schema.js";
import * as appRepo from "../src/modules/applications/repo.js";
import { hdr, drainQueue, waitFor, USER_ROLES, ADMIN_ROLES, TENANT_A, TENANT_B, ACTOR_A } from "./support.js";

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
  registerApplicationConsumers(queue);
  registerPermitConsumers(queue);
  registerInspectionConsumers(queue);
  registerRestorationConsumers(queue);
  await queue.start();
});

afterAll(async () => {
  await app.close();
  await sqlClient.end();
});

const appBody = {
  applicantName: "Isolation Test Applicant",
  purpose: "telecom" as const,
  location: { latitude: 18.52, longitude: 73.85, address: "1 Test St" },
  roadType: "local" as const,
  cuttingLength: "2",
  cuttingWidth: "2",
  cuttingDepth: "1",
};

describe("tenant isolation — applications", () => {
  it("tenant B cannot read tenant A's application by id, and list excludes it", async () => {
    const create = await app.inject({ method: "POST", url: "/v1/roadcut/applications", headers: hdr(ACTOR_A, TENANT_A, USER_ROLES), payload: appBody });
    const id = (create.json() as { id: string }).id;
    await waitFor(async () => (await app.inject({ method: "GET", url: `/v1/roadcut/applications/${id}`, headers: hdr(ACTOR_A, TENANT_A, USER_ROLES) })).statusCode === 200);

    const crossGet = await app.inject({ method: "GET", url: `/v1/roadcut/applications/${id}`, headers: hdr(ACTOR_A, TENANT_B, USER_ROLES) });
    expect(crossGet.statusCode).toBe(404);

    const crossList = await app.inject({ method: "GET", url: "/v1/roadcut/applications", headers: hdr(ACTOR_A, TENANT_B, USER_ROLES) });
    expect(crossList.statusCode).toBe(200);
    expect(crossList.json().data.find((a: { id: string }) => a.id === id)).toBeUndefined();
  });

  it("tenant B cannot submit tenant A's application (CAS + RLS both scope to caller's tenant)", async () => {
    const create = await app.inject({ method: "POST", url: "/v1/roadcut/applications", headers: hdr(ACTOR_A, TENANT_A, USER_ROLES), payload: appBody });
    const id = (create.json() as { id: string }).id;
    await waitFor(async () => (await app.inject({ method: "GET", url: `/v1/roadcut/applications/${id}`, headers: hdr(ACTOR_A, TENANT_A, USER_ROLES) })).statusCode === 200);

    const crossSubmit = await app.inject({ method: "POST", url: `/v1/roadcut/applications/${id}/submit`, headers: hdr(ACTOR_A, TENANT_B, USER_ROLES) });
    // findById scoped to TENANT_B sees nothing at this id -> 404, not 202/422.
    expect(crossSubmit.statusCode).toBe(404);

    const stillDraft = (await app.inject({ method: "GET", url: `/v1/roadcut/applications/${id}`, headers: hdr(ACTOR_A, TENANT_A, USER_ROLES) })).json().data;
    expect(stillDraft.status).toBe("draft");
  });
});

describe("tenant isolation — permits and inspections", () => {
  it("tenant B cannot issue a permit against tenant A's application, cannot read tenant A's permit, and list excludes it", async () => {
    const create = await app.inject({ method: "POST", url: "/v1/roadcut/applications", headers: hdr(ACTOR_A, TENANT_A, USER_ROLES), payload: appBody });
    const applicationId = (create.json() as { id: string }).id;
    await waitFor(async () => (await app.inject({ method: "GET", url: `/v1/roadcut/applications/${applicationId}`, headers: hdr(ACTOR_A, TENANT_A, USER_ROLES) })).statusCode === 200);
    await app.inject({ method: "POST", url: `/v1/roadcut/applications/${applicationId}/submit`, headers: hdr(ACTOR_A, TENANT_A, USER_ROLES) });
    await waitFor(async () => (await app.inject({ method: "GET", url: `/v1/roadcut/applications/${applicationId}`, headers: hdr(ACTOR_A, TENANT_A, USER_ROLES) })).json().data.status === "submitted");
    await app.inject({ method: "POST", url: `/v1/roadcut/applications/${applicationId}/start-review`, headers: hdr(ACTOR_A, TENANT_A, ADMIN_ROLES) });
    await waitFor(async () => (await app.inject({ method: "GET", url: `/v1/roadcut/applications/${applicationId}`, headers: hdr(ACTOR_A, TENANT_A, USER_ROLES) })).json().data.status === "under_review");
    await app.inject({ method: "POST", url: `/v1/roadcut/applications/${applicationId}/approve`, headers: hdr(ACTOR_A, TENANT_A, ADMIN_ROLES) });
    await waitFor(async () => (await app.inject({ method: "GET", url: `/v1/roadcut/applications/${applicationId}`, headers: hdr(ACTOR_A, TENANT_A, USER_ROLES) })).json().data.status === "approved");

    // Tenant B's own findById scoping means tenant A's application is
    // invisible to it -> pre-accept 404, never reaches "wrong status".
    const crossIssue = await app.inject({
      method: "POST",
      url: "/v1/roadcut/permits",
      headers: hdr(ACTOR_A, TENANT_B, ADMIN_ROLES),
      payload: { applicationId, workStartDate: "2027-01-10", workEndDate: "2027-02-10" },
    });
    expect(crossIssue.statusCode).toBe(404);

    const issue = await app.inject({ method: "POST", url: "/v1/roadcut/permits", headers: hdr(ACTOR_A, TENANT_A, ADMIN_ROLES), payload: { applicationId, workStartDate: "2027-01-10", workEndDate: "2027-02-10" } });
    const permitId = (issue.json() as { id: string }).id;
    await waitFor(async () => (await app.inject({ method: "GET", url: `/v1/roadcut/permits/${permitId}`, headers: hdr(ACTOR_A, TENANT_A, USER_ROLES) })).statusCode === 200);

    const crossGet = await app.inject({ method: "GET", url: `/v1/roadcut/permits/${permitId}`, headers: hdr(ACTOR_A, TENANT_B, USER_ROLES) });
    expect(crossGet.statusCode).toBe(404);

    const crossList = await app.inject({ method: "GET", url: "/v1/roadcut/permits", headers: hdr(ACTOR_A, TENANT_B, USER_ROLES) });
    expect(crossList.json().data.find((p: { id: string }) => p.id === permitId)).toBeUndefined();

    const crossSchedule = await app.inject({
      method: "POST",
      url: "/v1/roadcut/inspections",
      headers: hdr(ACTOR_A, TENANT_B, ADMIN_ROLES),
      payload: { permitId, inspectionType: "pre_work", inspectorId: ACTOR_A, scheduledDate: "2027-01-15" },
    });
    expect(crossSchedule.statusCode).toBe(404);
  });
});

/**
 * RLS defense-in-depth — WITH REAL TEETH, not just app-level filtering.
 *
 * Every test above goes through repo.findById(id, tenantId) / repo.list(
 * tenantId, ...), and EVERY one of those functions already puts
 * eq(table.tenantId, tenantId) in its own WHERE clause. That means those
 * tests pass even with RLS completely disabled — application code alone
 * already scopes every query correctly. They exercise the real HTTP path,
 * which has value, but they do NOT prove the database-level backstop
 * (FORCE ROW LEVEL SECURITY + the tenant_isolation policy) is doing
 * anything.
 *
 * Verified directly against this exact suite: ran
 *   ALTER TABLE roadcut.roadcut_applications NO FORCE ROW LEVEL SECURITY;
 * then re-ran this file. Every test ABOVE this one still passed (proof they
 * don't have teeth against an RLS regression, i.e. a future repo function
 * that forgets its own tenantId filter), while the raw-query test below
 * FAILED (tenant B's session saw tenant A's row) -- exactly the gap this
 * test is meant to catch. Restored with
 *   ALTER TABLE roadcut.roadcut_applications FORCE ROW LEVEL SECURITY;
 * and re-verified the whole suite green again before committing.
 *
 * This test closes that gap: it queries the table directly with NO
 * tenant_id predicate in the query itself (`tx.select().from(table)`, no
 * .where() at all), relying ENTIRELY on the RLS policy + the app.tenant_id
 * GUC (set here via runWithTenant, the same mechanism app.ts's onRequest
 * hooks use for a real request) to scope the result.
 */
describe("RLS defense-in-depth — raw query, no app-level tenant filter", () => {
  it("a raw SELECT with no WHERE tenant_id clause, scoped only by the RLS GUC, returns none of another tenant's rows", async () => {
    const tenantARowId = randomUUID();
    await runWithTenant(TENANT_A, () =>
      db.transaction(async (tx) => {
        const applicationNumber = `ROADCUT/RLSTEST/${new Date().getUTCFullYear()}/${String(
          await appRepo.nextApplicationNumber(tx),
        ).padStart(6, "0")}`;
        await tx.insert(roadcutApplications).values({
          id: tenantARowId,
          tenantId: TENANT_A,
          applicationNumber,
          status: "draft",
          applicantName: "RLS Direct-Query Test Applicant",
          applicantOrg: null,
          purpose: "water_pipe",
          location: { latitude: 0, longitude: 0, address: "x" },
          roadType: "local",
          cuttingLength: "1",
          cuttingWidth: "1",
          cuttingDepth: "1",
          documents: [],
          feeMinor: 100000n,
          depositMinor: 200000n,
          currency: "INR",
          createdBy: ACTOR_A,
          updatedBy: ACTOR_A,
        });
      }),
    );

    // Tenant B's session, querying with NO tenant_id predicate at all --
    // whatever scoping happens here comes ONLY from RLS + the GUC.
    const rowsVisibleToTenantB = await runWithTenant(TENANT_B, () =>
      db.transaction((tx) => tx.select().from(roadcutApplications)),
    );
    expect(rowsVisibleToTenantB.find((r) => r.id === tenantARowId)).toBeUndefined();

    // Sanity check on the other side: tenant A's OWN session, same
    // no-predicate query, DOES see it -- proves this isn't just an empty
    // table or a broken GUC making everything invisible.
    const rowsVisibleToTenantA = await runWithTenant(TENANT_A, () =>
      db.transaction((tx) => tx.select().from(roadcutApplications)),
    );
    expect(rowsVisibleToTenantA.find((r) => r.id === tenantARowId)).toBeDefined();
  });
});
