/**
 * lifecycle module — live end-to-end proof of the pre-accept status guard
 * added to cancellation and surrender in this pass. renewal and
 * zone-transfer already checked `lic.status !== "active"` before publishing
 * a command; cancellation and surrender loaded the licence (so a 404 for a
 * nonexistent one already worked) but never checked its status, so a
 * request to cancel/surrender an already-cancelled/suspended/expired
 * licence was silently accepted (202) and queued a vendor_renewals row that
 * could never usefully be decided. Both routes now match the sibling
 * routes' exact pattern.
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
import { registerLifecycleConsumers } from "../src/modules/lifecycle/consumer.js";
import { hdr, drainQueue, waitFor, TENANT_A, ACTOR_A } from "./support.js";

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
  registerRegistrationConsumers(queue);
  registerCommitteeConsumers(queue);
  registerLicenceConsumers(queue);
  registerLifecycleConsumers(queue);
  await queue.start();
});

afterAll(async () => {
  await app.close();
  await sqlClient.end();
});

async function activeLicence(): Promise<string> {
  const create = await app.inject({
    method: "POST",
    url: "/v1/vendor/registrations",
    headers: hdr(ACTOR_A, TENANT_A, ["vendor_user"]),
    payload: { vendorName: "Lifecycle Test Vendor", vendorAadhaar: "123456789066", vendorPhone: "9876533333", category: "food" },
  });
  const regId = (create.json() as { id: string }).id;
  await waitFor(async () => (await app.inject({ method: "GET", url: `/v1/vendor/registrations/${regId}`, headers: hdr() })).statusCode === 200);
  await app.inject({ method: "POST", url: `/v1/vendor/registrations/${regId}/submit`, headers: hdr() });
  await drainQueue();
  const assign = await app.inject({ method: "POST", url: "/v1/vendor/committee/reviews", headers: hdr(), payload: { registrationId: regId, committeeType: "zone_committee" } });
  await drainQueue();
  const reviewId = (assign.json() as { id: string }).id;
  await app.inject({ method: "POST", url: `/v1/vendor/committee/reviews/${reviewId}/complete`, headers: hdr(), payload: { findings: {}, recommendation: "approve" } });
  await drainQueue();
  await app.inject({ method: "POST", url: "/v1/vendor/committee/decide", headers: hdr(), payload: { registrationId: regId, decision: "approved" } });
  await drainQueue();

  const issue = await app.inject({
    method: "POST",
    url: "/v1/vendor/licences",
    headers: hdr(),
    payload: {
      registrationId: regId,
      zone: "Zone 3",
      spotNumber: "S-5",
      validFrom: new Date().toISOString(),
      validUntil: new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString(),
    },
  });
  const licId = (issue.json() as { id: string }).id;
  await waitFor(async () => (await app.inject({ method: "GET", url: `/v1/vendor/licences/${licId}`, headers: hdr() })).statusCode === 200);
  return licId;
}

async function licenceStatus(id: string): Promise<string> {
  return (await app.inject({ method: "GET", url: `/v1/vendor/licences/${id}`, headers: hdr() })).json().data.status;
}

describe("lifecycle — cancellation pre-accept status guard (fix)", () => {
  it("accepts a cancellation request for an active licence", async () => {
    const licId = await activeLicence();
    const res = await app.inject({
      method: "POST",
      url: "/v1/vendor/lifecycle/cancellation",
      headers: hdr(ACTOR_A, TENANT_A, ["vendor_user"]),
      payload: { licenceId: licId, reason: "Vendor relocating" },
    });
    expect(res.statusCode).toBe(202);
    await drainQueue();
    const list = (await app.inject({ method: "GET", url: `/v1/vendor/lifecycle?licenceId=${licId}`, headers: hdr() })).json().data;
    expect(list.some((r: { renewalType: string }) => r.renewalType === "cancellation")).toBe(true);
  });

  it("rejects a cancellation request for a licence that is already suspended (previously silently accepted — this is the fix)", async () => {
    const licId = await activeLicence();
    const suspend = await app.inject({ method: "POST", url: `/v1/vendor/licences/${licId}/suspend`, headers: hdr(), payload: { reason: "compliance hold" } });
    expect(suspend.statusCode).toBe(202);
    await drainQueue();
    expect(await licenceStatus(licId)).toBe("suspended");

    const cancellation = await app.inject({
      method: "POST",
      url: "/v1/vendor/lifecycle/cancellation",
      headers: hdr(),
      payload: { licenceId: licId, reason: "trying anyway" },
    });
    expect(cancellation.statusCode).toBe(422);
    expect(cancellation.json().code).toBe("INVALID_STATUS");
  });

  it("404s a cancellation request for a licence that does not exist", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/vendor/lifecycle/cancellation",
      headers: hdr(),
      payload: { licenceId: randomUUID(), reason: "n/a" },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe("lifecycle — surrender pre-accept status guard (fix)", () => {
  it("accepts a surrender request for an active licence", async () => {
    const licId = await activeLicence();
    const res = await app.inject({
      method: "POST",
      url: "/v1/vendor/lifecycle/surrender",
      headers: hdr(),
      payload: { licenceId: licId, reason: "Business closed" },
    });
    expect(res.statusCode).toBe(202);
  });

  it("rejects a surrender request for a licence that is already cancelled (previously silently accepted — this is the fix)", async () => {
    const licId = await activeLicence();
    const cancel = await app.inject({ method: "POST", url: `/v1/vendor/licences/${licId}/cancel`, headers: hdr(), payload: { reason: "admin cancel" } });
    expect(cancel.statusCode).toBe(202);
    await drainQueue();
    expect(await licenceStatus(licId)).toBe("cancelled");

    const surrender = await app.inject({
      method: "POST",
      url: "/v1/vendor/lifecycle/surrender",
      headers: hdr(),
      payload: { licenceId: licId, reason: "trying anyway" },
    });
    expect(surrender.statusCode).toBe(422);
    expect(surrender.json().code).toBe("INVALID_STATUS");
  });
});

describe("lifecycle — renewal / zone-transfer status guards (regression, already correct)", () => {
  it("rejects a renewal request for a suspended licence", async () => {
    const licId = await activeLicence();
    await app.inject({ method: "POST", url: `/v1/vendor/licences/${licId}/suspend`, headers: hdr(), payload: { reason: "hold" } });
    await drainQueue();

    const renewal = await app.inject({ method: "POST", url: "/v1/vendor/lifecycle/renewal", headers: hdr(), payload: { licenceId: licId } });
    expect(renewal.statusCode).toBe(422);
  });

  it("accepts a zone-transfer request for an active licence", async () => {
    const licId = await activeLicence();
    const res = await app.inject({
      method: "POST",
      url: "/v1/vendor/lifecycle/zone-transfer",
      headers: hdr(),
      payload: { licenceId: licId, newZone: "Zone 9", newSpot: "S-99" },
    });
    expect(res.statusCode).toBe(202);
  });
});

describe("lifecycle — decide status guard (regression)", () => {
  it("rejects deciding a lifecycle request twice", async () => {
    const licId = await activeLicence();
    const cancellation = await app.inject({
      method: "POST",
      url: "/v1/vendor/lifecycle/cancellation",
      headers: hdr(),
      payload: { licenceId: licId, reason: "vendor request" },
    });
    await drainQueue();
    const requestId = (cancellation.json() as { id: string }).id;

    const decide1 = await app.inject({ method: "POST", url: `/v1/vendor/lifecycle/${requestId}/decide`, headers: hdr(), payload: { decision: "approved" } });
    expect(decide1.statusCode).toBe(202);
    await drainQueue();

    const decide2 = await app.inject({ method: "POST", url: `/v1/vendor/lifecycle/${requestId}/decide`, headers: hdr(), payload: { decision: "approved" } });
    expect(decide2.statusCode).toBe(422);
  });
});
