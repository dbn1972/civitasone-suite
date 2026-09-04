/**
 * licences module — live end-to-end proof of the two fixes made to this
 * module in this pass:
 *
 *  1. POST /v1/vendor/licences (routes.ts) previously published
 *     issueLicence for ANY UUID-shaped registrationId with no existence or
 *     state check on the underlying registration. Now 404s for a
 *     registration that doesn't exist, and 422s for one that exists but
 *     hasn't cleared committee review (status !== "approved").
 *
 *  2. POST /v1/vendor/licences/:id/fee-payment had no idempotency guard —
 *     vendor_licences had no fee_paid column at all (see migrations/
 *     0003_licence_fee_paid.sql). A retry/double-click republished
 *     recordLicenceFee indefinitely. Now rejects a second attempt with 409
 *     FEE_ALREADY_PAID.
 *
 * Also covers the sequence-based (non-collidable) licence number — see
 * tests/number-sequences.test.ts for the concurrency proof.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { registerRegistrationConsumers } from "../src/modules/registrations/consumer.js";
import { registerCommitteeConsumers } from "../src/modules/committee/consumer.js";
import { registerLicenceConsumers } from "../src/modules/licences/consumer.js";
import { hdr, drainQueue, waitFor, TENANT_A, ACTOR_A } from "./support.js";

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
  registerRegistrationConsumers(queue);
  registerCommitteeConsumers(queue);
  registerLicenceConsumers(queue);
  await queue.start();
});

afterAll(async () => {
  await app.close();
  await sqlClient.end();
});

/** Drives a registration all the way to "approved" via the real pipeline. */
async function approvedRegistration(): Promise<string> {
  const create = await app.inject({
    method: "POST",
    url: "/v1/vendor/registrations",
    headers: hdr(ACTOR_A, TENANT_A, ["vendor_user"]),
    payload: {
      vendorName: "Licence Test Vendor",
      vendorAadhaar: "123456789088",
      vendorPhone: "9876511111",
      category: "service",
    },
  });
  const regId = (create.json() as { id: string }).id;
  await waitFor(async () => (await app.inject({ method: "GET", url: `/v1/vendor/registrations/${regId}`, headers: hdr() })).statusCode === 200);

  await app.inject({ method: "POST", url: `/v1/vendor/registrations/${regId}/submit`, headers: hdr() });
  await drainQueue();
  const assign = await app.inject({
    method: "POST",
    url: "/v1/vendor/committee/reviews",
    headers: hdr(),
    payload: { registrationId: regId, committeeType: "zone_committee" },
  });
  await drainQueue();
  const reviewId = (assign.json() as { id: string }).id;
  await app.inject({
    method: "POST",
    url: `/v1/vendor/committee/reviews/${reviewId}/complete`,
    headers: hdr(),
    payload: { findings: {}, recommendation: "approve" },
  });
  await drainQueue();
  await app.inject({
    method: "POST",
    url: "/v1/vendor/committee/decide",
    headers: hdr(),
    payload: { registrationId: regId, decision: "approved" },
  });
  await drainQueue();
  return regId;
}

async function issueLicence(registrationId: string): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: "/v1/vendor/licences",
    headers: hdr(),
    payload: {
      registrationId,
      zone: "Zone 2",
      spotNumber: "S-9",
      validFrom: new Date().toISOString(),
      validUntil: new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString(),
    },
  });
  expect(res.statusCode).toBe(202);
  const id = (res.json() as { id: string }).id;
  await waitFor(async () => (await app.inject({ method: "GET", url: `/v1/vendor/licences/${id}`, headers: hdr() })).statusCode === 200);
  return id;
}

describe("licences — pre-accept existence/state check on issue", () => {
  it("404s issuing a licence for a registration that does not exist", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/vendor/licences",
      headers: hdr(),
      payload: {
        registrationId: randomUUID(),
        zone: "Zone 1",
        spotNumber: "S-1",
        validFrom: new Date().toISOString(),
        validUntil: new Date(Date.now() + 1000 * 3600).toISOString(),
      },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe("REGISTRATION_NOT_FOUND");
  });

  it("422s issuing a licence for a registration that exists but has not cleared committee review yet", async () => {
    const create = await app.inject({
      method: "POST",
      url: "/v1/vendor/registrations",
      headers: hdr(ACTOR_A, TENANT_A, ["vendor_user"]),
      payload: { vendorName: "Not Yet Approved", vendorAadhaar: "123456789077", vendorPhone: "9876522222", category: "food" },
    });
    const regId = (create.json() as { id: string }).id;
    await waitFor(async () => (await app.inject({ method: "GET", url: `/v1/vendor/registrations/${regId}`, headers: hdr() })).statusCode === 200);
    // still "draft" -- never submitted, let alone approved

    const res = await app.inject({
      method: "POST",
      url: "/v1/vendor/licences",
      headers: hdr(),
      payload: {
        registrationId: regId,
        zone: "Zone 1",
        spotNumber: "S-1",
        validFrom: new Date().toISOString(),
        validUntil: new Date(Date.now() + 1000 * 3600).toISOString(),
      },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("INVALID_STATUS");
  });

  it("issues a licence for an approved registration, persisting a real (non-collidable) licence number", async () => {
    const regId = await approvedRegistration();
    const licId = await issueLicence(regId);
    const lic = (await app.inject({ method: "GET", url: `/v1/vendor/licences/${licId}`, headers: hdr() })).json().data;
    expect(lic.status).toBe("active");
    expect(lic.registrationId).toBe(regId);
    expect(lic.licenceNumber).toMatch(/^VLIC\/ULB\/\d{4}\/\d{6}$/);
    expect(lic.feePaid).toBe(false);
  });
});

describe("licences — fee-payment idempotency", () => {
  it("first payment succeeds and persists feePaid + the transaction id; a second attempt is rejected 409", async () => {
    const regId = await approvedRegistration();
    const licId = await issueLicence(regId);

    const firstPay = await app.inject({
      method: "POST",
      url: `/v1/vendor/licences/${licId}/fee-payment`,
      headers: hdr(ACTOR_A, TENANT_A, ["vendor_user"]),
      payload: { transactionId: "TXN-0001" },
    });
    expect(firstPay.statusCode).toBe(202);
    await drainQueue();

    const afterFirst = (await app.inject({ method: "GET", url: `/v1/vendor/licences/${licId}`, headers: hdr() })).json().data;
    expect(afterFirst.feePaid).toBe(true);
    expect(afterFirst.feeTransactionId).toBe("TXN-0001");

    const secondPay = await app.inject({
      method: "POST",
      url: `/v1/vendor/licences/${licId}/fee-payment`,
      headers: hdr(ACTOR_A, TENANT_A, ["vendor_user"]),
      payload: { transactionId: "TXN-0002-RETRY" },
    });
    expect(secondPay.statusCode).toBe(409);
    expect(secondPay.json().code).toBe("FEE_ALREADY_PAID");

    // Duplicate attempt must not have overwritten the original transaction id.
    const afterSecond = (await app.inject({ method: "GET", url: `/v1/vendor/licences/${licId}`, headers: hdr() })).json().data;
    expect(afterSecond.feeTransactionId).toBe("TXN-0001");
  });

  it("404s fee-payment for a licence that does not exist", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/vendor/licences/${randomUUID()}/fee-payment`,
      headers: hdr(),
      payload: { transactionId: "TXN-X" },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe("licences — suspend/cancel status guards (regression)", () => {
  it("rejects cancelling a licence that is already cancelled", async () => {
    const regId = await approvedRegistration();
    const licId = await issueLicence(regId);
    const cancel = await app.inject({ method: "POST", url: `/v1/vendor/licences/${licId}/cancel`, headers: hdr(), payload: { reason: "closed" } });
    expect(cancel.statusCode).toBe(202);
    await drainQueue();

    const secondCancel = await app.inject({ method: "POST", url: `/v1/vendor/licences/${licId}/cancel`, headers: hdr(), payload: { reason: "closed again" } });
    expect(secondCancel.statusCode).toBe(422);
  });
});
