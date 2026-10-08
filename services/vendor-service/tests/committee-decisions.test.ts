/**
 * committee module — decision-side coverage that committee.test.ts does not
 * reach: the rejection branch of the decide pipeline (consumer + notification),
 * and the pre-accept guards on complete / allocate-zone / decide.
 * Same live-DB convention as committee.test.ts (real consumers, in-memory
 * queue drained before asserting persisted state).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { registerRegistrationConsumers } from "../src/modules/registrations/consumer.js";
import { registerCommitteeConsumers } from "../src/modules/committee/consumer.js";
import { hdr, drainQueue, waitFor, TENANT_A, ACTOR_A } from "./support.js";

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
  registerRegistrationConsumers(queue);
  registerCommitteeConsumers(queue);
  await queue.start();
});

afterAll(async () => {
  await app.close();
  await sqlClient.end();
});

async function submittedRegistration(aadhaar: string): Promise<string> {
  const create = await app.inject({
    method: "POST",
    url: "/v1/vendor/registrations",
    headers: hdr(ACTOR_A, TENANT_A, ["vendor_user"]),
    payload: { vendorName: "Committee Decision Vendor", vendorAadhaar: aadhaar, vendorPhone: "9876500111", category: "non_food" },
  });
  const id = (create.json() as { id: string }).id;
  await waitFor(async () => (await app.inject({ method: "GET", url: `/v1/vendor/registrations/${id}`, headers: hdr() })).statusCode === 200);
  await app.inject({ method: "POST", url: `/v1/vendor/registrations/${id}/submit`, headers: hdr() });
  await drainQueue();
  return id;
}

async function registrationStatus(id: string): Promise<string> {
  return (await app.inject({ method: "GET", url: `/v1/vendor/registrations/${id}`, headers: hdr() })).json().data.status;
}

async function assignReview(registrationId: string): Promise<string> {
  const assign = await app.inject({
    method: "POST",
    url: "/v1/vendor/committee/reviews",
    headers: hdr(),
    payload: { registrationId, committeeType: "zone_committee" },
  });
  expect(assign.statusCode).toBe(202);
  await drainQueue();
  return (assign.json() as { id: string }).id;
}

describe("committee decisions", () => {
  it("rejecting a registration under review records the rejection and moves it to 'rejected'", async () => {
    const regId = await submittedRegistration("123456789201");
    await assignReview(regId);
    expect(await registrationStatus(regId)).toBe("under_review");

    const decide = await app.inject({
      method: "POST",
      url: "/v1/vendor/committee/decide",
      headers: hdr(),
      payload: { registrationId: regId, decision: "rejected", reason: "Incomplete documents" },
    });
    expect(decide.statusCode).toBe(202);
    await drainQueue();
    expect(await registrationStatus(regId)).toBe("rejected");
  });

  it("refuses to complete the same committee review twice", async () => {
    const regId = await submittedRegistration("123456789202");
    const reviewId = await assignReview(regId);

    const first = await app.inject({
      method: "POST",
      url: `/v1/vendor/committee/reviews/${reviewId}/complete`,
      headers: hdr(),
      payload: { findings: { note: "ok" }, recommendation: "defer" },
    });
    expect(first.statusCode).toBe(202);
    await drainQueue();

    const second = await app.inject({
      method: "POST",
      url: `/v1/vendor/committee/reviews/${reviewId}/complete`,
      headers: hdr(),
      payload: { findings: { note: "again" }, recommendation: "approve" },
    });
    expect(second.statusCode).toBe(422);
    expect(second.json().code).toBe("ALREADY_COMPLETED");
  });

  it("404s completing a committee review that does not exist", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/vendor/committee/reviews/${randomUUID()}/complete`,
      headers: hdr(),
      payload: { findings: {}, recommendation: "approve" },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe("REVIEW_NOT_FOUND");
  });

  it("guards allocate-zone: unknown registration is 404, one that is not under review is 422", async () => {
    const unknown = await app.inject({
      method: "POST",
      url: "/v1/vendor/committee/allocate-zone",
      headers: hdr(),
      payload: { registrationId: randomUUID(), zone: "Zone 1", spot: "S-1" },
    });
    expect(unknown.statusCode).toBe(404);

    const regId = await submittedRegistration("123456789203");
    const notUnderReview = await app.inject({
      method: "POST",
      url: "/v1/vendor/committee/allocate-zone",
      headers: hdr(),
      payload: { registrationId: regId, zone: "Zone 1", spot: "S-1" },
    });
    expect(notUnderReview.statusCode).toBe(422);
    expect(notUnderReview.json().code).toBe("INVALID_STATUS");
  });

  it("guards decide: unknown registration is 404, one that is not under review is 422", async () => {
    const unknown = await app.inject({
      method: "POST",
      url: "/v1/vendor/committee/decide",
      headers: hdr(),
      payload: { registrationId: randomUUID(), decision: "approved" },
    });
    expect(unknown.statusCode).toBe(404);

    const regId = await submittedRegistration("123456789204");
    const notUnderReview = await app.inject({
      method: "POST",
      url: "/v1/vendor/committee/decide",
      headers: hdr(),
      payload: { registrationId: regId, decision: "approved" },
    });
    expect(notUnderReview.statusCode).toBe(422);
    expect(notUnderReview.json().code).toBe("INVALID_STATUS");
  });

  it("lists the committee reviews recorded against a registration", async () => {
    const regId = await submittedRegistration("123456789205");
    const reviewId = await assignReview(regId);

    const res = await app.inject({
      method: "GET",
      url: `/v1/vendor/committee/reviews?registrationId=${regId}`,
      headers: hdr(),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: Array<{ id: string; status: string }>; meta: { total: number } };
    expect(body.meta.total).toBe(1);
    expect(body.data[0]).toMatchObject({ id: reviewId, status: "pending" });
  });
});
