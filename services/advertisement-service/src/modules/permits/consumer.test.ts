/**
 * Real, DB-backed permits tests — route → consumer → persisted-state.
 *
 * Replaces the previous fully vi.mock'd consumer.test.ts. Covers this
 * branch's fixes:
 *  - money field: renewBody.feeMinor now zMoneyMinorStringNonNeg, rejected
 *    synchronously at the route (400) instead of throwing inside the
 *    consumer's write transaction after 202.
 *  - pre-accept validation on POST /permits (application must exist and be
 *    approved; no duplicate permit for the same application) and POST
 *    /permits/:id/renew (permit must be in a renewable status).
 *  - collision-prone permit-number generation, replaced with a real
 *    Postgres SEQUENCE.
 *  - the pre-existing renewPermit regression test (validUntil actually
 *    getting written back onto the permit row, not just the renewal
 *    record).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../app.js";
import { queue } from "../../shared/infra.js";
import { sqlClient } from "../../shared/db.js";
import { registerApplicationConsumers } from "../applications/consumer.js";
import { registerApprovalConsumers } from "../approvals/consumer.js";
import { registerPermitConsumers } from "./consumer.js";
import * as repo from "./repo.js";
import { tokenForTenant, settle } from "../../shared/test-helpers.js";

const TENANT = randomUUID();
const ACTOR = randomUUID();
const ROLES = ["adv_admin"]; // covers both ADV_ROLES and OFFICER_ROLES checks in this module

let app: FastifyInstance;
let authed: { authorization: string; "content-type": string };

beforeAll(async () => {
  registerApplicationConsumers(queue);
  registerApprovalConsumers(queue);
  registerPermitConsumers(queue);
  await queue.start();
  app = await buildApp();
  authed = { authorization: `Bearer ${tokenForTenant(TENANT, ACTOR, ROLES)}`, "content-type": "application/json" };
});

afterAll(async () => {
  await app.close();
  await queue.stop();
  await sqlClient.end();
});

async function createApprovedApplication(): Promise<string> {
  const create = await app.inject({
    method: "POST",
    url: "/v1/advertisement/applications",
    headers: authed,
    payload: {
      advertiserName: "Acme Ads",
      advertiserOrg: "Acme Pvt Ltd",
      advertisementType: "hoarding",
      location: { address: "MG Road" },
      dimensions: { widthFt: 20, heightFt: 10, areaInSqFt: 200 },
    },
  });
  const { id: applicationId } = create.json() as { id: string };
  await settle();
  // No content-type/body on this call — the submit route takes no payload,
  // and Fastify's JSON body parser 400s on an empty body when
  // content-type: application/json is set with nothing to parse.
  await app.inject({ method: "POST", url: `/v1/advertisement/applications/${applicationId}/submit`, headers: { authorization: authed.authorization } });
  await settle();
  await app.inject({
    method: "POST",
    url: "/v1/advertisement/approvals/scrutiny",
    headers: authed,
    payload: { applicationId, scrutinyType: "zone_check", officerId: ACTOR },
  });
  await settle();
  await app.inject({
    method: "POST",
    url: "/v1/advertisement/approvals/decide",
    headers: authed,
    payload: { applicationId, decision: "approved" },
  });
  await settle();
  return applicationId;
}

function issuePayload(applicationId: string) {
  return {
    applicationId,
    validFrom: "2026-01-01",
    validUntil: "2026-12-31",
    location: { address: "MG Road" },
    advertisementType: "hoarding",
  };
}

async function issuePermitFor(applicationId: string): Promise<string> {
  const res = await app.inject({ method: "POST", url: "/v1/advertisement/permits", headers: authed, payload: issuePayload(applicationId) });
  expect(res.statusCode).toBe(202);
  const { id } = res.json() as { id: string };
  await settle();
  return id;
}

describe("POST /v1/advertisement/permits — pre-accept validation + persisted state", () => {
  it("404s when the referenced application does not exist", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/advertisement/permits", headers: authed, payload: issuePayload(randomUUID()) });
    expect(res.statusCode).toBe(404);
  });

  it("422s when the referenced application exists but is not approved", async () => {
    const create = await app.inject({
      method: "POST",
      url: "/v1/advertisement/applications",
      headers: authed,
      payload: {
        advertiserName: "Acme Ads", advertiserOrg: "Acme Pvt Ltd", advertisementType: "hoarding",
        location: { address: "MG Road" }, dimensions: { widthFt: 20, heightFt: 10, areaInSqFt: 200 },
      },
    });
    const { id: applicationId } = create.json() as { id: string };
    await settle(); // still "draft", never submitted/approved

    const res = await app.inject({ method: "POST", url: "/v1/advertisement/permits", headers: authed, payload: issuePayload(applicationId) });
    expect(res.statusCode).toBe(422);
  });

  it("202-accepts for an approved application, and the consumer persists an active permit with a generated permit number", async () => {
    const applicationId = await createApprovedApplication();
    const permitId = await issuePermitFor(applicationId);

    const permit = await repo.findById(permitId, TENANT);
    expect(permit).not.toBeNull();
    expect(permit!.status).toBe("active");
    expect(permit!.applicationId).toBe(applicationId);
    expect(permit!.permitNumber).toMatch(/^ADVP\/ULB\/\d{4}\/\d{6}$/);
    expect(permit!.verificationCode).toHaveLength(32);
  });

  it("409s on a second permit for the same already-permitted application", async () => {
    const applicationId = await createApprovedApplication();
    await issuePermitFor(applicationId);

    const second = await app.inject({ method: "POST", url: "/v1/advertisement/permits", headers: authed, payload: issuePayload(applicationId) });
    expect(second.statusCode).toBe(409);
  });

  it("two permits issued for two different approved applications get distinct, non-colliding permit numbers (collision-prone-generator regression)", async () => {
    const [appA, appB] = await Promise.all([createApprovedApplication(), createApprovedApplication()]);
    const [permitIdA, permitIdB] = await Promise.all([issuePermitFor(appA), issuePermitFor(appB)]);
    const [permitA, permitB] = await Promise.all([repo.findById(permitIdA, TENANT), repo.findById(permitIdB, TENANT)]);
    expect(permitA!.permitNumber).not.toBe(permitB!.permitNumber);
  });
});

describe("permits repo — reissuing after cancellation is allowed (partial unique index, not a plain UNIQUE)", () => {
  it("a cancelled permit does not block a fresh permit for the same application", async () => {
    const applicationId = await createApprovedApplication();
    const firstId = await issuePermitFor(applicationId);

    const cancel = await app.inject({ method: "POST", url: `/v1/advertisement/permits/${firstId}/cancel`, headers: authed, payload: { reason: "issued in error, applicant needs to reschedule" } });
    expect(cancel.statusCode).toBe(202);
    await settle();
    const cancelled = await repo.findById(firstId, TENANT);
    expect(cancelled!.status).toBe("cancelled");

    // adv_permits_application_active_unique (migrations/0004) and
    // findByApplication's app-level pre-check must both treat the
    // cancelled permit as non-blocking.
    const second = await app.inject({ method: "POST", url: "/v1/advertisement/permits", headers: authed, payload: issuePayload(applicationId) });
    expect(second.statusCode).toBe(202);
    const { id: secondId } = second.json() as { id: string };
    expect(secondId).not.toBe(firstId);
    await settle();

    const reissued = await repo.findById(secondId, TENANT);
    expect(reissued).not.toBeNull();
    expect(reissued!.status).toBe("active");
  });

  it("still blocks a duplicate against an ACTIVE (non-cancelled) permit for the same application", async () => {
    const applicationId = await createApprovedApplication();
    await issuePermitFor(applicationId);

    const second = await app.inject({ method: "POST", url: "/v1/advertisement/permits", headers: authed, payload: issuePayload(applicationId) });
    expect(second.statusCode).toBe(409);
  });
});

describe("POST /v1/advertisement/permits/:id/renew — money field + pre-accept validation", () => {
  it("400s on a non-numeric feeMinor, before 202 (money field regression)", async () => {
    const applicationId = await createApprovedApplication();
    const permitId = await issuePermitFor(applicationId);

    const res = await app.inject({
      method: "POST",
      url: `/v1/advertisement/permits/${permitId}/renew`,
      headers: authed,
      payload: { renewalType: "renewal", newValidUntil: "2027-12-31", feeMinor: "not-a-number" },
    });
    expect(res.statusCode).toBe(400);

    // And crucially: no renewal command was ever published, so validUntil
    // on the permit is untouched — the old bug was this failing INSIDE the
    // consumer transaction post-202, not at the route.
    const permit = await repo.findById(permitId, TENANT);
    expect(permit!.validUntil).toBe("2026-12-31");
  });

  it("202-accepts a valid feeMinor and the consumer writes the new validUntil back onto the permit (not just the renewal record)", async () => {
    const applicationId = await createApprovedApplication();
    const permitId = await issuePermitFor(applicationId);

    const res = await app.inject({
      method: "POST",
      url: `/v1/advertisement/permits/${permitId}/renew`,
      headers: authed,
      payload: { renewalType: "renewal", newValidUntil: "2027-12-31", feeMinor: "150000" },
    });
    expect(res.statusCode).toBe(202);
    await settle();

    const permit = await repo.findById(permitId, TENANT);
    expect(permit!.validUntil).toBe("2027-12-31");
  });

  it("422s renewing a cancelled permit (pre-accept state validation)", async () => {
    const applicationId = await createApprovedApplication();
    const permitId = await issuePermitFor(applicationId);
    const cancel = await app.inject({ method: "POST", url: `/v1/advertisement/permits/${permitId}/cancel`, headers: authed, payload: { reason: "test cancel" } });
    expect(cancel.statusCode).toBe(202);
    await settle();

    const permit = await repo.findById(permitId, TENANT);
    expect(permit!.status).toBe("cancelled");

    const renew = await app.inject({
      method: "POST",
      url: `/v1/advertisement/permits/${permitId}/renew`,
      headers: authed,
      payload: { renewalType: "renewal", newValidUntil: "2028-12-31", feeMinor: "150000" },
    });
    expect(renew.statusCode).toBe(422);
  });
});

describe("suspend / cancel — persisted state", () => {
  it("suspend persists suspendedAt + reason", async () => {
    const applicationId = await createApprovedApplication();
    const permitId = await issuePermitFor(applicationId);

    const res = await app.inject({ method: "POST", url: `/v1/advertisement/permits/${permitId}/suspend`, headers: authed, payload: { reason: "unsafe structure" } });
    expect(res.statusCode).toBe(202);
    await settle();

    const permit = await repo.findById(permitId, TENANT);
    expect(permit!.status).toBe("suspended");
    expect(permit!.suspensionReason).toBe("unsafe structure");
    expect(permit!.suspendedAt).not.toBeNull();
  });
});
