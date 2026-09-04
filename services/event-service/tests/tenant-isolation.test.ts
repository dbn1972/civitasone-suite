/**
 * Cross-tenant RLS isolation — proves the FORCE ROW LEVEL SECURITY /
 * tenant_isolation policies added in migrations/0001_initial.sql actually
 * hold for every domain table in this service (event_applications,
 * event_noc_requests, event_permits, event_post_inspections all use the
 * identical policy shape). Mirrors services/vendor-service/tests/
 * tenant-isolation.test.ts.
 *
 * IMPORTANT — proving these assertions have real teeth: application-level
 * RLS tests only prove the app's CURRENT configuration isolates tenants;
 * they say nothing about whether the test would actually catch a
 * regression. As part of verifying this suite (see the PR description's
 * Verification section for the transcript), FORCE ROW LEVEL SECURITY was
 * temporarily stripped from all four tables in this isolated test database
 * (ALTER TABLE event.<table> NO FORCE ROW LEVEL SECURITY; — event_svc, the
 * migration-owning role, is the table OWNER, so without FORCE it bypasses
 * RLS entirely, same as any table owner), and THIS file kept passing
 * anyway — because it only ever goes through the tenant-filtered HTTP
 * routes, which independently filter by ctx.tenantId regardless of what
 * RLS does. rls-raw.test.ts exists specifically to close that gap: it was
 * confirmed to FAIL under the same stripped-FORCE condition, and both
 * files were re-confirmed passing once FORCE was restored.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { registerApplicationConsumers } from "../src/modules/applications/consumer.js";
import { registerNocConsumers } from "../src/modules/nocs/consumer.js";
import { registerPermitConsumers } from "../src/modules/permits/consumer.js";
import { registerPostEventConsumers } from "../src/modules/post_event/consumer.js";
import { hdr, drainQueue, waitFor, TENANT_A, TENANT_B, ACTOR_A } from "./support.js";

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
  registerApplicationConsumers(queue);
  registerNocConsumers(queue);
  registerPermitConsumers(queue);
  registerPostEventConsumers(queue);
  await queue.start();
});

afterAll(async () => {
  await app.close();
  await sqlClient.end();
});

describe("tenant isolation — applications", () => {
  it("tenant B cannot read tenant A's application by id, and list excludes it", async () => {
    const create = await app.inject({
      method: "POST",
      url: "/v1/event/applications",
      headers: hdr(ACTOR_A, TENANT_A),
      payload: {
        organiserName: "Isolation Org",
        organiserPhone: "9876500010",
        eventType: "sports",
        venueName: "Ground",
        venueAddress: { line1: "1 Rd", city: "Springfield", pin: "500001" },
        startDate: "2026-10-01",
        endDate: "2026-10-02",
        expectedAttendance: 80,
      },
    });
    const id = (create.json() as { id: string }).id;
    await waitFor(async () => (await app.inject({ method: "GET", url: `/v1/event/applications/${id}`, headers: hdr(ACTOR_A, TENANT_A) })).statusCode === 200);

    const crossGet = await app.inject({ method: "GET", url: `/v1/event/applications/${id}`, headers: hdr(ACTOR_A, TENANT_B) });
    expect(crossGet.statusCode).toBe(404);

    const crossList = await app.inject({ method: "GET", url: "/v1/event/applications", headers: hdr(ACTOR_A, TENANT_B) });
    expect(crossList.statusCode).toBe(200);
    expect(crossList.json().data.find((r: { id: string }) => r.id === id)).toBeUndefined();
  });

  it("tenant B cannot submit or withdraw tenant A's application", async () => {
    const create = await app.inject({
      method: "POST",
      url: "/v1/event/applications",
      headers: hdr(ACTOR_A, TENANT_A),
      payload: {
        organiserName: "Isolation Org 2",
        organiserPhone: "9876500011",
        eventType: "sports",
        venueName: "Ground",
        venueAddress: { line1: "1 Rd", city: "Springfield", pin: "500001" },
        startDate: "2026-10-01",
        endDate: "2026-10-02",
        expectedAttendance: 80,
      },
    });
    const id = (create.json() as { id: string }).id;
    await waitFor(async () => (await app.inject({ method: "GET", url: `/v1/event/applications/${id}`, headers: hdr(ACTOR_A, TENANT_A) })).statusCode === 200);

    const crossSubmit = await app.inject({ method: "POST", url: `/v1/event/applications/${id}/submit`, headers: hdr(ACTOR_A, TENANT_B) });
    expect(crossSubmit.statusCode).toBe(404);

    const ownGet = await app.inject({ method: "GET", url: `/v1/event/applications/${id}`, headers: hdr(ACTOR_A, TENANT_A) });
    expect(ownGet.json().data.status).toBe("draft");
  });
});

describe("tenant isolation — nocs", () => {
  it("tenant B cannot request a NOC against tenant A's application (cross-tenant reference is refused), and cannot list or respond to tenant A's NOCs", async () => {
    const create = await app.inject({
      method: "POST",
      url: "/v1/event/applications",
      headers: hdr(ACTOR_A, TENANT_A),
      payload: {
        organiserName: "Isolation NOC Org",
        organiserPhone: "9876500012",
        eventType: "sports",
        venueName: "Ground",
        venueAddress: { line1: "1 Rd", city: "Springfield", pin: "500001" },
        startDate: "2026-10-01",
        endDate: "2026-10-02",
        expectedAttendance: 80,
      },
    });
    const applicationId = (create.json() as { id: string }).id;
    await waitFor(async () => (await app.inject({ method: "GET", url: `/v1/event/applications/${applicationId}`, headers: hdr(ACTOR_A, TENANT_A) })).statusCode === 200);

    const crossRequest = await app.inject({ method: "POST", url: "/v1/event/nocs", headers: hdr(ACTOR_A, TENANT_B), payload: { applicationId, department: "police" } });
    expect(crossRequest.statusCode).toBe(404);

    const ownNoc = await app.inject({ method: "POST", url: "/v1/event/nocs", headers: hdr(ACTOR_A, TENANT_A), payload: { applicationId, department: "police" } });
    const nocId = (ownNoc.json() as { id: string }).id;
    await waitFor(async () => (await app.inject({ method: "GET", url: `/v1/event/nocs?applicationId=${applicationId}`, headers: hdr(ACTOR_A, TENANT_A) })).json().data.some((r: { id: string }) => r.id === nocId));

    const crossList = await app.inject({ method: "GET", url: `/v1/event/nocs?applicationId=${applicationId}`, headers: hdr(ACTOR_A, TENANT_B) });
    expect(crossList.json().data).toEqual([]);

    const crossRespond = await app.inject({ method: "POST", url: `/v1/event/nocs/${nocId}/respond`, headers: hdr(ACTOR_A, TENANT_B), payload: { status: "approved" } });
    expect(crossRespond.statusCode).toBe(404);
  });
});

describe("tenant isolation — permits and post-event inspections", () => {
  async function eligibleApplicationForTenant(tenant: string): Promise<string> {
    const create = await app.inject({
      method: "POST",
      url: "/v1/event/applications",
      headers: hdr(ACTOR_A, tenant),
      payload: {
        organiserName: "Isolation Permit Org",
        organiserPhone: "9876500013",
        eventType: "sports",
        venueName: "Ground",
        venueAddress: { line1: "1 Rd", city: "Springfield", pin: "500001" },
        startDate: "2020-01-01",
        endDate: "2020-01-02",
        expectedAttendance: 80,
      },
    });
    const applicationId = (create.json() as { id: string }).id;
    await waitFor(async () => (await app.inject({ method: "GET", url: `/v1/event/applications/${applicationId}`, headers: hdr(ACTOR_A, tenant) })).statusCode === 200);
    await app.inject({ method: "POST", url: `/v1/event/applications/${applicationId}/submit`, headers: hdr(ACTOR_A, tenant) });
    await drainQueue();
    const nocCreate = await app.inject({ method: "POST", url: "/v1/event/nocs", headers: hdr(ACTOR_A, tenant), payload: { applicationId, department: "police" } });
    const nocId = (nocCreate.json() as { id: string }).id;
    await waitFor(async () => (await app.inject({ method: "GET", url: `/v1/event/nocs?applicationId=${applicationId}`, headers: hdr(ACTOR_A, tenant) })).json().data.some((r: { id: string }) => r.id === nocId));
    await app.inject({ method: "POST", url: `/v1/event/nocs/${nocId}/respond`, headers: hdr(ACTOR_A, tenant), payload: { status: "approved" } });
    await drainQueue();
    return applicationId;
  }

  it("tenant B cannot read tenant A's permit, revoke it, or conduct/read a post-event inspection against it", async () => {
    const applicationId = await eligibleApplicationForTenant(TENANT_A);
    const issue = await app.inject({
      method: "POST",
      url: "/v1/event/permits",
      headers: hdr(ACTOR_A, TENANT_A),
      payload: { applicationId, validFrom: "2020-01-01T00:00:00Z", validUntil: "2020-01-02T00:00:00Z" },
    });
    const permitId = (issue.json() as { id: string }).id;
    await waitFor(async () => (await app.inject({ method: "GET", url: `/v1/event/permits/${permitId}`, headers: hdr(ACTOR_A, TENANT_A) })).statusCode === 200);

    const crossGet = await app.inject({ method: "GET", url: `/v1/event/permits/${permitId}`, headers: hdr(ACTOR_A, TENANT_B) });
    expect(crossGet.statusCode).toBe(404);

    const crossRevoke = await app.inject({ method: "POST", url: `/v1/event/permits/${permitId}/revoke`, headers: hdr(ACTOR_A, TENANT_B), payload: { reason: "cross-tenant attempt" } });
    expect(crossRevoke.statusCode).toBe(404);

    // permits/routes.ts's checkInspectionEligibility path is reached via
    // post-event routes, which look the permit up tenant-scoped too --
    // tenant B's post-inspection attempt must see it as not found, not as a
    // real permit it can inspect.
    const crossInspect = await app.inject({
      method: "POST",
      url: "/v1/event/post-inspections",
      headers: hdr(ACTOR_A, TENANT_B),
      payload: { permitId, findings: {} },
    });
    expect(crossInspect.statusCode).toBe(422);
    expect(crossInspect.json().code).toBe("NOT_ELIGIBLE_FOR_INSPECTION");

    // Tenant A's own permit is untouched by tenant B's attempts.
    const own = await app.inject({ method: "GET", url: `/v1/event/permits/${permitId}`, headers: hdr(ACTOR_A, TENANT_A) });
    expect(own.json().data.status).toBe("issued");
  });

  it("tenant B cannot read or decide a deposit on tenant A's post-event inspection", async () => {
    const applicationId = await eligibleApplicationForTenant(TENANT_A);
    const issue = await app.inject({
      method: "POST",
      url: "/v1/event/permits",
      headers: hdr(ACTOR_A, TENANT_A),
      payload: { applicationId, validFrom: "2020-01-01T00:00:00Z", validUntil: "2020-01-02T00:00:00Z" },
    });
    const permitId = (issue.json() as { id: string }).id;
    await waitFor(async () => (await app.inject({ method: "GET", url: `/v1/event/permits/${permitId}`, headers: hdr(ACTOR_A, TENANT_A) })).statusCode === 200);
    const conduct = await app.inject({ method: "POST", url: "/v1/event/post-inspections", headers: hdr(ACTOR_A, TENANT_A), payload: { permitId, findings: {} } });
    const inspectionId = (conduct.json() as { id: string }).id;
    await waitFor(async () => (await app.inject({ method: "GET", url: `/v1/event/post-inspections/${inspectionId}`, headers: hdr(ACTOR_A, TENANT_A) })).statusCode === 200);

    const crossGet = await app.inject({ method: "GET", url: `/v1/event/post-inspections/${inspectionId}`, headers: hdr(ACTOR_A, TENANT_B) });
    expect(crossGet.statusCode).toBe(404);

    const crossDecide = await app.inject({
      method: "POST",
      url: `/v1/event/post-inspections/${inspectionId}/deposit`,
      headers: hdr(ACTOR_A, TENANT_B),
      payload: { decision: "full_refund" },
    });
    expect(crossDecide.statusCode).toBe(404);

    const own = await app.inject({ method: "GET", url: `/v1/event/post-inspections/${inspectionId}`, headers: hdr(ACTOR_A, TENANT_A) });
    expect(own.json().data.depositDecision).toBeNull();
  });
});
