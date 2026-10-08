/**
 * lifecycle module — the accepted-request and decision paths that
 * lifecycle.test.ts does not drive: renewal and zone-transfer consumers
 * (fee + details persisted), deciding a request approved / rejected, and the
 * decide / list guards. Same live-DB convention as lifecycle.test.ts.
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

type LifecycleRow = { id: string; renewalType: string; status: string; feeMinor: string | number; details?: Record<string, unknown> | null };

async function activeLicence(aadhaar: string): Promise<string> {
  const create = await app.inject({
    method: "POST",
    url: "/v1/vendor/registrations",
    headers: hdr(ACTOR_A, TENANT_A, ["vendor_user"]),
    payload: { vendorName: "Lifecycle Decision Vendor", vendorAadhaar: aadhaar, vendorPhone: "9876533444", category: "food" },
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
      zone: "Zone 4",
      spotNumber: "S-8",
      validFrom: new Date().toISOString(),
      validUntil: new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString(),
    },
  });
  const licId = (issue.json() as { id: string }).id;
  await waitFor(async () => (await app.inject({ method: "GET", url: `/v1/vendor/licences/${licId}`, headers: hdr() })).statusCode === 200);
  return licId;
}

async function requests(licId: string): Promise<LifecycleRow[]> {
  return (await app.inject({ method: "GET", url: `/v1/vendor/lifecycle?licenceId=${licId}`, headers: hdr() })).json().data;
}

describe("lifecycle — accepted requests are persisted by the consumers", () => {
  it("records a renewal with the 750.00 INR renewal fee (75000 paise) in 'submitted' state", async () => {
    const licId = await activeLicence("123456789301");
    const res = await app.inject({ method: "POST", url: "/v1/vendor/lifecycle/renewal", headers: hdr(), payload: { licenceId: licId } });
    expect(res.statusCode).toBe(202);
    await drainQueue();

    const renewal = (await requests(licId)).find((r) => r.renewalType === "renewal");
    expect(renewal).toBeDefined();
    expect(renewal!.status).toBe("submitted");
    expect(String(renewal!.feeMinor)).toBe("75000");
  });

  it("records a zone transfer with the 500.00 INR fee and the requested zone/spot", async () => {
    const licId = await activeLicence("123456789302");
    const res = await app.inject({
      method: "POST",
      url: "/v1/vendor/lifecycle/zone-transfer",
      headers: hdr(),
      payload: { licenceId: licId, newZone: "Zone 9", newSpot: "S-99" },
    });
    expect(res.statusCode).toBe(202);
    await drainQueue();

    const transfer = (await requests(licId)).find((r) => r.renewalType === "zone_transfer");
    expect(transfer).toBeDefined();
    expect(String(transfer!.feeMinor)).toBe("50000");
    expect(transfer!.details).toMatchObject({ newZone: "Zone 9", newSpot: "S-99" });
  });

  it("records a surrender request carrying its reason and no fee", async () => {
    const licId = await activeLicence("123456789303");
    const res = await app.inject({
      method: "POST",
      url: "/v1/vendor/lifecycle/surrender",
      headers: hdr(),
      payload: { licenceId: licId, reason: "Business closed" },
    });
    expect(res.statusCode).toBe(202);
    await drainQueue();

    const surrender = (await requests(licId)).find((r) => r.renewalType === "surrender");
    expect(surrender).toBeDefined();
    expect(String(surrender!.feeMinor)).toBe("0");
    expect(surrender!.details).toMatchObject({ reason: "Business closed" });
  });
});

describe("lifecycle — deciding a request", () => {
  it("approves a renewal request and records the decision", async () => {
    const licId = await activeLicence("123456789304");
    await app.inject({ method: "POST", url: "/v1/vendor/lifecycle/renewal", headers: hdr(), payload: { licenceId: licId } });
    await drainQueue();
    const renewal = (await requests(licId)).find((r) => r.renewalType === "renewal")!;

    const decide = await app.inject({
      method: "POST",
      url: `/v1/vendor/lifecycle/${renewal.id}/decide`,
      headers: hdr(),
      payload: { decision: "approved", newValidUntil: new Date(Date.now() + 2 * 365 * 24 * 3600 * 1000).toISOString() },
    });
    expect(decide.statusCode).toBe(202);
    await drainQueue();

    const decided = (await requests(licId)).find((r) => r.id === renewal.id)!;
    expect(decided.status).toBe("approved");
  });

  it("rejects a zone-transfer request with a reason, after which it can no longer be decided", async () => {
    const licId = await activeLicence("123456789305");
    await app.inject({
      method: "POST",
      url: "/v1/vendor/lifecycle/zone-transfer",
      headers: hdr(),
      payload: { licenceId: licId, newZone: "Zone 2", newSpot: "S-2" },
    });
    await drainQueue();
    const transfer = (await requests(licId)).find((r) => r.renewalType === "zone_transfer")!;

    const decide = await app.inject({
      method: "POST",
      url: `/v1/vendor/lifecycle/${transfer.id}/decide`,
      headers: hdr(),
      payload: { decision: "rejected", reason: "Spot already allocated" },
    });
    expect(decide.statusCode).toBe(202);
    await drainQueue();
    expect((await requests(licId)).find((r) => r.id === transfer.id)!.status).toBe("rejected");

    const again = await app.inject({
      method: "POST",
      url: `/v1/vendor/lifecycle/${transfer.id}/decide`,
      headers: hdr(),
      payload: { decision: "approved" },
    });
    expect(again.statusCode).toBe(422);
    expect(again.json().code).toBe("INVALID_STATUS");
  });

  it("404s deciding a lifecycle request that does not exist", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/vendor/lifecycle/${randomUUID()}/decide`,
      headers: hdr(),
      payload: { decision: "approved" },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe("REQUEST_NOT_FOUND");
  });

  it("404s a renewal for a licence that does not exist", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/vendor/lifecycle/renewal", headers: hdr(), payload: { licenceId: randomUUID() } });
    expect(res.statusCode).toBe(404);
  });

  it("requires the licenceId query on the lifecycle listing", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/vendor/lifecycle", headers: hdr() });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    expect(res.statusCode).toBeLessThan(500);
  });
});

describe("licence status guards used by the lifecycle flow", () => {
  it("refuses to suspend a licence that is already suspended", async () => {
    const licId = await activeLicence("123456789306");
    const first = await app.inject({ method: "POST", url: `/v1/vendor/licences/${licId}/suspend`, headers: hdr(), payload: { reason: "hold" } });
    expect(first.statusCode).toBe(202);
    await drainQueue();

    const second = await app.inject({ method: "POST", url: `/v1/vendor/licences/${licId}/suspend`, headers: hdr(), payload: { reason: "hold again" } });
    expect(second.statusCode).toBe(422);
    expect(second.json().code).toBe("INVALID_STATUS");
  });

  it("refuses to issue a licence for a registration that does not exist or has not been approved", async () => {
    const issueFor = (registrationId: string) =>
      app.inject({
        method: "POST",
        url: "/v1/vendor/licences",
        headers: hdr(),
        payload: {
          registrationId,
          zone: "Zone 1",
          spotNumber: "S-1",
          validFrom: new Date().toISOString(),
          validUntil: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
        },
      });

    expect((await issueFor(randomUUID())).statusCode).toBe(404);

    const draft = await app.inject({
      method: "POST",
      url: "/v1/vendor/registrations",
      headers: hdr(ACTOR_A, TENANT_A, ["vendor_user"]),
      payload: { vendorName: "Unapproved Vendor", vendorAadhaar: "123456789307", vendorPhone: "9876533555", category: "food" },
    });
    const regId = (draft.json() as { id: string }).id;
    await waitFor(async () => (await app.inject({ method: "GET", url: `/v1/vendor/registrations/${regId}`, headers: hdr() })).statusCode === 200);
    const notApproved = await issueFor(regId);
    expect(notApproved.statusCode).toBe(422);
    expect(notApproved.json().code).toBe("INVALID_STATUS");
  });

  it("lists licences filtered by status with the requested page size, and defaults the page metadata", async () => {
    const licId = await activeLicence("123456789308");

    const filtered = await app.inject({ method: "GET", url: "/v1/vendor/licences?status=active&page=1&pageSize=5", headers: hdr() });
    expect(filtered.statusCode).toBe(200);
    const body = filtered.json() as { data: Array<{ id: string; status: string }>; meta: { page: number; pageSize: number; total: number } };
    expect(body.meta).toMatchObject({ page: 1, pageSize: 5 });
    expect(body.data.length).toBeLessThanOrEqual(5);
    expect(body.data.every((l) => l.status === "active")).toBe(true);
    expect(body.meta.total).toBeGreaterThanOrEqual(1);

    const defaults = await app.inject({ method: "GET", url: "/v1/vendor/licences", headers: hdr() });
    expect(defaults.json().meta).toMatchObject({ page: 1, pageSize: 20 });

    const one = await app.inject({ method: "GET", url: `/v1/vendor/licences/${licId}`, headers: hdr() });
    expect(one.json().data.id).toBe(licId);
  });
});
