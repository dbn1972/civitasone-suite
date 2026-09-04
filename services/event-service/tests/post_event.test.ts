/**
 * Route -> consumer -> persisted-state coverage for the post_event module,
 * centered on the two headline fixes praised in this pass:
 *
 *  1. checkInspectionEligibility (domain.ts): a post-event inspection used
 *     to be recordable against ANY permitId, including a revoked one or one
 *     whose event hasn't happened yet.
 *  2. computeRefundMinor + the two-hop permit -> application lookup in
 *     routes.ts's /deposit handler: refundMinor used to be entirely
 *     client-supplied with no relationship to the deposit actually
 *     collected. It is now derived server-side from
 *     application.depositMinor (reached via inspection -> permit ->
 *     application), and only ever consults the client's requested amount
 *     for partial_refund, bounds-checked against that real deposit.
 *
 * The tests below build a REAL application with a REAL, non-trivial
 * server-computed depositMinor (expectedAttendance=600 -> 2,500,000 minor
 * units per calculateDepositMinor), carry it through NOC approval, permit
 * issuance and inspection, and then prove the deposit decision honours that
 * exact figure end-to-end -- not a value the client supplied.
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
 * Builds a fully-issued, already-concluded permit (validUntil in the past,
 * so checkInspectionEligibility passes immediately) for an application with
 * expectedAttendance=600 -> depositMinor = 2,500,000 (Rs 25,000) per
 * calculateDepositMinor (the >500 tier). eventType "sports" with
 * soundPermission omitted keeps determineRequiredNocs from adding "health"
 * (cultural/religious/commercial only) or "environment" (soundPermission
 * only), but attendance 600 is both > 200 and > 100, so all of
 * ["police", "fire", "traffic"] are required -- this helper requests and
 * approves exactly those three so checkPermitEligibility passes.
 */
async function issuedPermitWithKnownDeposit(): Promise<{ permitId: string; applicationId: string; depositMinor: string }> {
  const create = await app.inject({
    method: "POST",
    url: "/v1/event/applications",
    headers: hdr(),
    payload: {
      organiserName: "Post-Event Test Org",
      organiserPhone: "9876500004",
      eventType: "sports",
      venueName: "Big Ground",
      venueAddress: { line1: "1 Big Rd", city: "Springfield", pin: "500001" },
      startDate: "2020-01-01",
      endDate: "2020-01-02",
      expectedAttendance: 600,
    },
  });
  const applicationId = (create.json() as { id: string }).id;
  await waitFor(async () => (await app.inject({ method: "GET", url: `/v1/event/applications/${applicationId}`, headers: hdr() })).statusCode === 200);
  const application = (await app.inject({ method: "GET", url: `/v1/event/applications/${applicationId}`, headers: hdr() })).json().data;
  expect(String(application.depositMinor)).toBe("2500000");

  await app.inject({ method: "POST", url: `/v1/event/applications/${applicationId}/submit`, headers: hdr() });
  await drainQueue();

  for (const department of ["police", "fire", "traffic"] as const) {
    const nocCreate = await app.inject({ method: "POST", url: "/v1/event/nocs", headers: hdr(), payload: { applicationId, department } });
    const nocId = (nocCreate.json() as { id: string }).id;
    await waitFor(async () => (await app.inject({ method: "GET", url: `/v1/event/nocs?applicationId=${applicationId}`, headers: hdr() })).json().data.some((r: { id: string }) => r.id === nocId));
    await app.inject({ method: "POST", url: `/v1/event/nocs/${nocId}/respond`, headers: hdr(), payload: { status: "approved" } });
    await drainQueue();
  }

  const issue = await app.inject({
    method: "POST",
    url: "/v1/event/permits",
    headers: hdr(),
    // Already-concluded event: validUntil is in the past, satisfying
    // checkInspectionEligibility's "event has not concluded yet" gate
    // immediately, with no need to fast-forward time in the test.
    payload: { applicationId, validFrom: "2020-01-01T00:00:00Z", validUntil: "2020-01-02T00:00:00Z" },
  });
  const permitId = (issue.json() as { id: string }).id;
  await waitFor(async () => (await app.inject({ method: "GET", url: `/v1/event/permits/${permitId}`, headers: hdr() })).statusCode === 200);

  return { permitId, applicationId, depositMinor: "2500000" };
}

async function conductedInspection(): Promise<{ inspectionId: string; permitId: string; applicationId: string; depositMinor: string }> {
  const { permitId, applicationId, depositMinor } = await issuedPermitWithKnownDeposit();
  const conduct = await app.inject({
    method: "POST",
    url: "/v1/event/post-inspections",
    headers: hdr(),
    payload: { permitId, findings: { venueCondition: "acceptable", minorDamage: false } },
  });
  expect(conduct.statusCode).toBe(202);
  const inspectionId = (conduct.json() as { id: string }).id;
  await waitFor(async () => (await app.inject({ method: "GET", url: `/v1/event/post-inspections/${inspectionId}`, headers: hdr() })).statusCode === 200);
  return { inspectionId, permitId, applicationId, depositMinor };
}

describe("POST /v1/event/post-inspections — pre-accept eligibility", () => {
  it("conducts an inspection once the permit exists and its event has concluded", async () => {
    const { permitId } = await issuedPermitWithKnownDeposit();
    const res = await app.inject({
      method: "POST",
      url: "/v1/event/post-inspections",
      headers: hdr(),
      payload: { permitId, findings: { venueCondition: "good" } },
    });
    expect(res.statusCode).toBe(202);
    const { id } = res.json() as { id: string };
    await waitFor(async () => (await app.inject({ method: "GET", url: `/v1/event/post-inspections/${id}`, headers: hdr() })).statusCode === 200);
    const row = (await app.inject({ method: "GET", url: `/v1/event/post-inspections/${id}`, headers: hdr() })).json().data;
    expect(row.permitId).toBe(permitId);
    expect(row.findings).toEqual({ venueCondition: "good" });
    expect(row.depositDecision).toBeNull();
  });

  it("rejects inspection for a nonexistent permitId with a route-level 422, never reaching the queue", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/event/post-inspections",
      headers: hdr(),
      payload: { permitId: "00000000-0000-4000-8000-000000000000", findings: {} },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("NOT_ELIGIBLE_FOR_INSPECTION");
  });

  it("rejects inspection for a revoked permit", async () => {
    const { permitId } = await issuedPermitWithKnownDeposit();
    await app.inject({ method: "POST", url: `/v1/event/permits/${permitId}/revoke`, headers: hdr(), payload: { reason: "test revoke" } });
    await drainQueue();

    const res = await app.inject({
      method: "POST",
      url: "/v1/event/post-inspections",
      headers: hdr(),
      payload: { permitId, findings: {} },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().message).toMatch(/revoked/);
  });

  it("rejects inspection for a permit whose event has NOT concluded yet (validUntil in the future)", async () => {
    const create = await app.inject({
      method: "POST",
      url: "/v1/event/applications",
      headers: hdr(),
      payload: {
        organiserName: "Future Event Org",
        organiserPhone: "9876500005",
        eventType: "sports",
        venueName: "Ground",
        venueAddress: { line1: "1 Rd", city: "Springfield", pin: "500001" },
        startDate: "2099-01-01",
        endDate: "2099-01-02",
        expectedAttendance: 80,
      },
    });
    const applicationId = (create.json() as { id: string }).id;
    await waitFor(async () => (await app.inject({ method: "GET", url: `/v1/event/applications/${applicationId}`, headers: hdr() })).statusCode === 200);
    await app.inject({ method: "POST", url: `/v1/event/applications/${applicationId}/submit`, headers: hdr() });
    await drainQueue();
    const nocCreate = await app.inject({ method: "POST", url: "/v1/event/nocs", headers: hdr(), payload: { applicationId, department: "police" } });
    const nocId = (nocCreate.json() as { id: string }).id;
    await waitFor(async () => (await app.inject({ method: "GET", url: `/v1/event/nocs?applicationId=${applicationId}`, headers: hdr() })).json().data.some((r: { id: string }) => r.id === nocId));
    await app.inject({ method: "POST", url: `/v1/event/nocs/${nocId}/respond`, headers: hdr(), payload: { status: "approved" } });
    await drainQueue();
    const issue = await app.inject({
      method: "POST",
      url: "/v1/event/permits",
      headers: hdr(),
      payload: { applicationId, validFrom: "2099-01-01T00:00:00Z", validUntil: "2099-01-02T00:00:00Z" },
    });
    const permitId = (issue.json() as { id: string }).id;
    await waitFor(async () => (await app.inject({ method: "GET", url: `/v1/event/permits/${permitId}`, headers: hdr() })).statusCode === 200);

    const res = await app.inject({
      method: "POST",
      url: "/v1/event/post-inspections",
      headers: hdr(),
      payload: { permitId, findings: {} },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().message).toMatch(/not concluded/);
  });
});

describe("POST /v1/event/post-inspections/:id/deposit — the two-hop derivation", () => {
  it("full_refund: refundMinor equals the REAL depositMinor collected on the application (reached via inspection -> permit -> application), ignoring any client-supplied value", async () => {
    const { inspectionId, depositMinor } = await conductedInspection();
    const res = await app.inject({
      method: "POST",
      url: `/v1/event/post-inspections/${inspectionId}/deposit`,
      headers: hdr(),
      // A client-supplied refundMinor of "1" is deliberately wrong for
      // full_refund -- the server must ignore it entirely and use the real
      // depositMinor it derived itself.
      payload: { decision: "full_refund", refundMinor: "1" },
    });
    expect(res.statusCode).toBe(202);
    await drainQueue();

    const row = (await app.inject({ method: "GET", url: `/v1/event/post-inspections/${inspectionId}`, headers: hdr() })).json().data;
    expect(row.depositDecision).toBe("full_refund");
    expect(String(row.refundMinor)).toBe(depositMinor);
  });

  it("forfeited: refundMinor is always 0, regardless of any client-supplied value", async () => {
    const { inspectionId } = await conductedInspection();
    const res = await app.inject({
      method: "POST",
      url: `/v1/event/post-inspections/${inspectionId}/deposit`,
      headers: hdr(),
      payload: { decision: "forfeited", refundMinor: "2500000" },
    });
    expect(res.statusCode).toBe(202);
    await drainQueue();

    const row = (await app.inject({ method: "GET", url: `/v1/event/post-inspections/${inspectionId}`, headers: hdr() })).json().data;
    expect(row.depositDecision).toBe("forfeited");
    expect(String(row.refundMinor)).toBe("0");
  });

  it("partial_refund: an amount within [0, depositMinor] is honoured exactly", async () => {
    const { inspectionId, depositMinor } = await conductedInspection();
    const requested = String(BigInt(depositMinor) - 500000n); // 2,000,000
    const res = await app.inject({
      method: "POST",
      url: `/v1/event/post-inspections/${inspectionId}/deposit`,
      headers: hdr(),
      payload: { decision: "partial_refund", refundMinor: requested },
    });
    expect(res.statusCode).toBe(202);
    await drainQueue();

    const row = (await app.inject({ method: "GET", url: `/v1/event/post-inspections/${inspectionId}`, headers: hdr() })).json().data;
    expect(row.depositDecision).toBe("partial_refund");
    expect(String(row.refundMinor)).toBe(requested);
  });

  it("partial_refund exceeding the real depositMinor is rejected with 422, and writes nothing", async () => {
    const { inspectionId, depositMinor } = await conductedInspection();
    const tooMuch = String(BigInt(depositMinor) + 1n);
    const res = await app.inject({
      method: "POST",
      url: `/v1/event/post-inspections/${inspectionId}/deposit`,
      headers: hdr(),
      payload: { decision: "partial_refund", refundMinor: tooMuch },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("INVALID_REFUND_AMOUNT");

    const row = (await app.inject({ method: "GET", url: `/v1/event/post-inspections/${inspectionId}`, headers: hdr() })).json().data;
    expect(row.depositDecision).toBeNull();
  });

  it("partial_refund with no refundMinor supplied is rejected with 422 before publishing (route-level, synchronous)", async () => {
    const { inspectionId } = await conductedInspection();
    const res = await app.inject({
      method: "POST",
      url: `/v1/event/post-inspections/${inspectionId}/deposit`,
      headers: hdr(),
      payload: { decision: "partial_refund" },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("INVALID_REFUND_AMOUNT");
  });

  it("a second deposit decision on an already-decided inspection is rejected with 422 and does not overwrite the first", async () => {
    const { inspectionId, depositMinor } = await conductedInspection();
    await app.inject({ method: "POST", url: `/v1/event/post-inspections/${inspectionId}/deposit`, headers: hdr(), payload: { decision: "full_refund" } });
    await drainQueue();

    const second = await app.inject({ method: "POST", url: `/v1/event/post-inspections/${inspectionId}/deposit`, headers: hdr(), payload: { decision: "forfeited" } });
    expect(second.statusCode).toBe(422);
    expect(second.json().code).toBe("ALREADY_DECIDED");

    const row = (await app.inject({ method: "GET", url: `/v1/event/post-inspections/${inspectionId}`, headers: hdr() })).json().data;
    expect(row.depositDecision).toBe("full_refund");
    expect(String(row.refundMinor)).toBe(depositMinor);
  });

  it("404s a deposit decision for a nonexistent inspection id", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/event/post-inspections/00000000-0000-4000-8000-000000000000/deposit",
      headers: hdr(),
      payload: { decision: "full_refund" },
    });
    expect(res.statusCode).toBe(404);
  });
});
