/**
 * Cross-tenant RLS isolation — proves the FORCE ROW LEVEL SECURITY /
 * tenant_isolation policies added in migrations/0001_initial.sql actually
 * hold for every domain table in this service (vendor_registrations,
 * vendor_committee_reviews, vendor_licences, vendor_renewals all use the
 * identical policy shape). Mirrors services/animal-service/tests/
 * tenant-isolation.test.ts.
 *
 * IMPORTANT — proving these assertions have real teeth: application-level
 * RLS tests only prove the app's CURRENT configuration isolates tenants;
 * they say nothing about whether the test would actually catch a
 * regression. As part of verifying this suite (not as a permanent part of
 * it — see the PR description's Verification section for the transcript),
 * FORCE ROW LEVEL SECURITY was temporarily stripped from all four tables in
 * this isolated test database ( ALTER TABLE vendor.<table>
 * NO FORCE ROW LEVEL SECURITY; — vendor_svc, the migration-owning role, is
 * the table OWNER, so without FORCE it bypasses RLS entirely, same as any
 * table owner), this suite was re-run and confirmed to FAIL (leak) on every
 * test below, and FORCE ROW LEVEL SECURITY was then restored and the suite
 * re-run to confirm it passes again. That is the actual proof these tests
 * are not vacuously green.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { registerRegistrationConsumers } from "../src/modules/registrations/consumer.js";
import { registerCommitteeConsumers } from "../src/modules/committee/consumer.js";
import { registerLicenceConsumers } from "../src/modules/licences/consumer.js";
import { registerLifecycleConsumers } from "../src/modules/lifecycle/consumer.js";
import { hdr, drainQueue, waitFor, TENANT_A, TENANT_B, ACTOR_A } from "./support.js";

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

async function approvedRegistrationForTenantA(): Promise<string> {
  const create = await app.inject({
    method: "POST",
    url: "/v1/vendor/registrations",
    headers: hdr(ACTOR_A, TENANT_A, ["vendor_user"]),
    payload: { vendorName: "RLS Test Vendor", vendorAadhaar: "123456789055", vendorPhone: "9876544444", category: "food" },
  });
  const regId = (create.json() as { id: string }).id;
  await waitFor(async () => (await app.inject({ method: "GET", url: `/v1/vendor/registrations/${regId}`, headers: hdr() })).statusCode === 200);
  await app.inject({ method: "POST", url: `/v1/vendor/registrations/${regId}/submit`, headers: hdr(ACTOR_A, TENANT_A) });
  await drainQueue();
  const assign = await app.inject({ method: "POST", url: "/v1/vendor/committee/reviews", headers: hdr(ACTOR_A, TENANT_A), payload: { registrationId: regId, committeeType: "zone_committee" } });
  await drainQueue();
  const reviewId = (assign.json() as { id: string }).id;
  await app.inject({ method: "POST", url: `/v1/vendor/committee/reviews/${reviewId}/complete`, headers: hdr(ACTOR_A, TENANT_A), payload: { findings: {}, recommendation: "approve" } });
  await drainQueue();
  await app.inject({ method: "POST", url: "/v1/vendor/committee/decide", headers: hdr(ACTOR_A, TENANT_A), payload: { registrationId: regId, decision: "approved" } });
  await drainQueue();
  return regId;
}

describe("tenant isolation — registrations", () => {
  it("tenant B cannot read tenant A's registration by id, and list excludes it", async () => {
    const create = await app.inject({
      method: "POST",
      url: "/v1/vendor/registrations",
      headers: hdr(ACTOR_A, TENANT_A, ["vendor_user"]),
      payload: { vendorName: "Isolation Vendor", vendorAadhaar: "123456789044", vendorPhone: "9876555555", category: "food" },
    });
    const id = (create.json() as { id: string }).id;
    await waitFor(async () => (await app.inject({ method: "GET", url: `/v1/vendor/registrations/${id}`, headers: hdr(ACTOR_A, TENANT_A) })).statusCode === 200);

    const crossGet = await app.inject({ method: "GET", url: `/v1/vendor/registrations/${id}`, headers: hdr(ACTOR_A, TENANT_B) });
    expect(crossGet.statusCode).toBe(404);

    const crossList = await app.inject({ method: "GET", url: "/v1/vendor/registrations", headers: hdr(ACTOR_A, TENANT_B) });
    expect(crossList.statusCode).toBe(200);
    expect(crossList.json().data.find((r: { id: string }) => r.id === id)).toBeUndefined();
  });

  it("tenant B cannot submit/withdraw tenant A's registration", async () => {
    const create = await app.inject({
      method: "POST",
      url: "/v1/vendor/registrations",
      headers: hdr(ACTOR_A, TENANT_A, ["vendor_user"]),
      payload: { vendorName: "Isolation Vendor 2", vendorAadhaar: "123456789033", vendorPhone: "9876566666", category: "food" },
    });
    const id = (create.json() as { id: string }).id;
    await waitFor(async () => (await app.inject({ method: "GET", url: `/v1/vendor/registrations/${id}`, headers: hdr(ACTOR_A, TENANT_A) })).statusCode === 200);

    const crossSubmit = await app.inject({ method: "POST", url: `/v1/vendor/registrations/${id}/submit`, headers: hdr(ACTOR_A, TENANT_B) });
    expect(crossSubmit.statusCode).toBe(404);

    const stillDraft = (await app.inject({ method: "GET", url: `/v1/vendor/registrations/${id}`, headers: hdr(ACTOR_A, TENANT_A) })).json().data;
    expect(stillDraft.status).toBe("draft");
  });
});

describe("tenant isolation — licences", () => {
  it("tenant B cannot issue a licence against tenant A's approved registration (pre-accept check is itself tenant-scoped)", async () => {
    const regId = await approvedRegistrationForTenantA();
    const res = await app.inject({
      method: "POST",
      url: "/v1/vendor/licences",
      headers: hdr(ACTOR_A, TENANT_B),
      payload: {
        registrationId: regId,
        zone: "Zone X",
        spotNumber: "S-X",
        validFrom: new Date().toISOString(),
        validUntil: new Date(Date.now() + 1000 * 3600).toISOString(),
      },
    });
    expect(res.statusCode).toBe(404);
  });

  it("tenant B cannot read tenant A's licence by id, list it, or pay its fee", async () => {
    const regId = await approvedRegistrationForTenantA();
    const issue = await app.inject({
      method: "POST",
      url: "/v1/vendor/licences",
      headers: hdr(ACTOR_A, TENANT_A),
      payload: {
        registrationId: regId,
        zone: "Zone Y",
        spotNumber: "S-Y",
        validFrom: new Date().toISOString(),
        validUntil: new Date(Date.now() + 1000 * 3600).toISOString(),
      },
    });
    const licId = (issue.json() as { id: string }).id;
    await waitFor(async () => (await app.inject({ method: "GET", url: `/v1/vendor/licences/${licId}`, headers: hdr(ACTOR_A, TENANT_A) })).statusCode === 200);

    const crossGet = await app.inject({ method: "GET", url: `/v1/vendor/licences/${licId}`, headers: hdr(ACTOR_A, TENANT_B) });
    expect(crossGet.statusCode).toBe(404);

    const crossList = await app.inject({ method: "GET", url: "/v1/vendor/licences", headers: hdr(ACTOR_A, TENANT_B) });
    expect(crossList.json().data.find((l: { id: string }) => l.id === licId)).toBeUndefined();

    const crossPay = await app.inject({
      method: "POST",
      url: `/v1/vendor/licences/${licId}/fee-payment`,
      headers: hdr(ACTOR_A, TENANT_B),
      payload: { transactionId: "TXN-CROSS" },
    });
    expect(crossPay.statusCode).toBe(404);
  });
});

describe("tenant isolation — lifecycle", () => {
  it("tenant B cannot request cancellation/surrender against tenant A's licence", async () => {
    const regId = await approvedRegistrationForTenantA();
    const issue = await app.inject({
      method: "POST",
      url: "/v1/vendor/licences",
      headers: hdr(ACTOR_A, TENANT_A),
      payload: {
        registrationId: regId,
        zone: "Zone Z",
        spotNumber: "S-Z",
        validFrom: new Date().toISOString(),
        validUntil: new Date(Date.now() + 1000 * 3600).toISOString(),
      },
    });
    const licId = (issue.json() as { id: string }).id;
    await waitFor(async () => (await app.inject({ method: "GET", url: `/v1/vendor/licences/${licId}`, headers: hdr(ACTOR_A, TENANT_A) })).statusCode === 200);

    const crossCancel = await app.inject({
      method: "POST",
      url: "/v1/vendor/lifecycle/cancellation",
      headers: hdr(ACTOR_A, TENANT_B),
      payload: { licenceId: licId, reason: "not mine" },
    });
    expect(crossCancel.statusCode).toBe(404);

    const stillActive = (await app.inject({ method: "GET", url: `/v1/vendor/licences/${licId}`, headers: hdr(ACTOR_A, TENANT_A) })).json().data;
    expect(stillActive.status).toBe("active");
  });
});
