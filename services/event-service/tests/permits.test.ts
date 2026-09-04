/**
 * Route -> consumer -> persisted-state coverage for the permits module,
 * centered on checkPermitEligibility (domain.ts): a permit used to be
 * issuable for ANY applicationId regardless of the application's status or
 * whether it had any approved NOCs at all. Both the route (fast 422) and
 * the consumer (the atomic gate) now enforce the same eligibility check;
 * these tests exercise both paths.
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
import { hdr, drainQueue, waitFor, TENANT_A } from "./support.js";

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

/**
 * sports / attendance 80 / no sound permission -> determineRequiredNocs
 * returns only ["police"] (see applications/domain.ts), keeping the fixture
 * to a single NOC department.
 */
async function createDraftApplication(overrides: Record<string, unknown> = {}): Promise<string> {
  const create = await app.inject({
    method: "POST",
    url: "/v1/event/applications",
    headers: hdr(),
    payload: {
      organiserName: "Permit Test Org",
      organiserPhone: "9876500003",
      eventType: "sports",
      venueName: "Test Ground",
      venueAddress: { line1: "1 Test St", city: "Springfield", pin: "500001" },
      startDate: "2026-10-01",
      endDate: "2026-10-02",
      expectedAttendance: 80,
      ...overrides,
    },
  });
  const id = (create.json() as { id: string }).id;
  await waitFor(async () => (await app.inject({ method: "GET", url: `/v1/event/applications/${id}`, headers: hdr() })).statusCode === 200);
  return id;
}

async function submitApplication(id: string): Promise<void> {
  await app.inject({ method: "POST", url: `/v1/event/applications/${id}/submit`, headers: hdr() });
  await drainQueue();
}

async function approvePoliceNoc(applicationId: string): Promise<void> {
  const create = await app.inject({ method: "POST", url: "/v1/event/nocs", headers: hdr(), payload: { applicationId, department: "police" } });
  const nocId = (create.json() as { id: string }).id;
  await waitFor(async () => (await app.inject({ method: "GET", url: `/v1/event/nocs?applicationId=${applicationId}`, headers: hdr() })).json().data.some((r: { id: string }) => r.id === nocId));
  await app.inject({ method: "POST", url: `/v1/event/nocs/${nocId}/respond`, headers: hdr(), payload: { status: "approved" } });
  await drainQueue();
}

/** A fully eligible application: submitted + its one required NOC approved. */
async function eligibleApplication(): Promise<string> {
  const id = await createDraftApplication();
  await submitApplication(id);
  await approvePoliceNoc(id);
  return id;
}

describe("POST /v1/event/permits — pre-accept eligibility", () => {
  it("issues a permit once the application is submitted and its required NOC is approved", async () => {
    const applicationId = await eligibleApplication();
    const res = await app.inject({
      method: "POST",
      url: "/v1/event/permits",
      headers: hdr(),
      payload: { applicationId, validFrom: "2026-10-01T00:00:00Z", validUntil: "2026-10-02T00:00:00Z" },
    });
    expect(res.statusCode).toBe(202);
    const { id } = res.json() as { id: string };

    await waitFor(async () => (await app.inject({ method: "GET", url: `/v1/event/permits/${id}`, headers: hdr() })).statusCode === 200);
    const permit = (await app.inject({ method: "GET", url: `/v1/event/permits/${id}`, headers: hdr() })).json().data;
    expect(permit.status).toBe("issued");
    expect(permit.permitNumber).toMatch(/^EVTP\/ULB\/\d{4}\/\d{6}$/);
    expect(permit.verificationCode).toHaveLength(8);

    // Side effect on the OTHER aggregate: issuing the permit also flips the
    // application to "permitted", atomically with the insert (same tx).
    const application = (await app.inject({ method: "GET", url: `/v1/event/applications/${applicationId}`, headers: hdr() })).json().data;
    expect(application.status).toBe("permitted");
  });

  it("rejects issuance at the route with 422 for a draft (unsubmitted) application, before any NOC exists", async () => {
    const applicationId = await createDraftApplication();
    const res = await app.inject({
      method: "POST",
      url: "/v1/event/permits",
      headers: hdr(),
      payload: { applicationId, validFrom: "2026-10-01T00:00:00Z", validUntil: "2026-10-02T00:00:00Z" },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("NOT_ELIGIBLE_FOR_PERMIT");
  });

  it("rejects issuance at the route with 422 when submitted but its required NOC has not been approved yet", async () => {
    const applicationId = await createDraftApplication();
    await submitApplication(applicationId);
    const res = await app.inject({
      method: "POST",
      url: "/v1/event/permits",
      headers: hdr(),
      payload: { applicationId, validFrom: "2026-10-01T00:00:00Z", validUntil: "2026-10-02T00:00:00Z" },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().message).toMatch(/police/);
  });

  it("rejects issuance for a nonexistent applicationId with 422 NOT_ELIGIBLE_FOR_PERMIT (not a 500)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/event/permits",
      headers: hdr(),
      payload: { applicationId: "00000000-0000-4000-8000-000000000000", validFrom: "2026-10-01T00:00:00Z", validUntil: "2026-10-02T00:00:00Z" },
    });
    expect(res.statusCode).toBe(422);
  });

  it("the consumer enforces eligibility itself, not just the route: an issuePermit command published directly for an ineligible application (bypassing the route's pre-check entirely) is refused and creates no permit", async () => {
    // MemoryQueue.publish() schedules delivery via a fire-and-forget
    // setTimeout(0) (see packages/queue-service/src/bus.ts), so there is no
    // reliable way to race two published commands against each other from a
    // test and control which one a consumer sees first. Instead, this
    // exercises the SAME real gate (checkPermitEligibility inside permits/
    // consumer.ts) the more direct way: publish the command straight to the
    // queue -- exactly as commands.issuePermit would, but without going
    // through the route's synchronous pre-check at all -- for an
    // application that is still "draft" with zero NOCs. If the consumer's
    // own eligibility re-check (the actual fix -- see permits/consumer.ts's
    // "CRITICAL fix" comment) were missing or dropped, this would silently
    // issue a permit anyway.
    const applicationId = await createDraftApplication();
    const { queue } = await import("../src/shared/infra.js");
    const { COMMANDS } = await import("../src/topics.js");
    const { randomUUID } = await import("node:crypto");
    const permitId = randomUUID();
    await queue.publish(COMMANDS.issuePermit, {
      messageId: randomUUID(),
      type: COMMANDS.issuePermit,
      tenantId: TENANT_A,
      actorId: "c3333333-0000-4000-8000-00000000000a",
      correlationId: `corr-${randomUUID()}`,
      schemaVersion: "1.0",
      payload: {
        id: permitId,
        tenantId: TENANT_A,
        applicationId,
        validFrom: "2026-10-01T00:00:00Z",
        validUntil: "2026-10-02T00:00:00Z",
      },
    });
    await drainQueue();

    const permit = await app.inject({ method: "GET", url: `/v1/event/permits/${permitId}`, headers: hdr() });
    expect(permit.statusCode).toBe(404);
    const application = (await app.inject({ method: "GET", url: `/v1/event/applications/${applicationId}`, headers: hdr() })).json().data;
    expect(application.status).toBe("draft");
  });
});

describe("POST /v1/event/permits/:id/revoke", () => {
  it("revokes an issued permit and rejects revoking it a second time", async () => {
    const applicationId = await eligibleApplication();
    const issue = await app.inject({
      method: "POST",
      url: "/v1/event/permits",
      headers: hdr(),
      payload: { applicationId, validFrom: "2026-10-01T00:00:00Z", validUntil: "2026-10-02T00:00:00Z" },
    });
    const permitId = (issue.json() as { id: string }).id;
    await waitFor(async () => (await app.inject({ method: "GET", url: `/v1/event/permits/${permitId}`, headers: hdr() })).statusCode === 200);

    const revoke = await app.inject({ method: "POST", url: `/v1/event/permits/${permitId}/revoke`, headers: hdr(), payload: { reason: "Venue safety violation" } });
    expect(revoke.statusCode).toBe(202);
    await drainQueue();

    const permit = (await app.inject({ method: "GET", url: `/v1/event/permits/${permitId}`, headers: hdr() })).json().data;
    expect(permit.status).toBe("revoked");

    const second = await app.inject({ method: "POST", url: `/v1/event/permits/${permitId}/revoke`, headers: hdr(), payload: { reason: "duplicate" } });
    expect(second.statusCode).toBe(422);
  });
});
