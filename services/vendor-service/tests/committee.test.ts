/**
 * committee module — live end-to-end proof of the full registration ->
 * committee review -> zone allocation -> decision pipeline, and of the
 * pre-accept status guards already present on every committee route
 * (assign/allocate/decide all check the underlying registration's status
 * before publishing a command — this module was already correct; these
 * tests are regression coverage, not new fixes).
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

async function createRegistration(status: "draft" | "submitted" = "submitted"): Promise<string> {
  const create = await app.inject({
    method: "POST",
    url: "/v1/vendor/registrations",
    headers: hdr(ACTOR_A, TENANT_A, ["vendor_user"]),
    payload: {
      vendorName: "Committee Test Vendor",
      vendorAadhaar: "123456789099",
      vendorPhone: "9876500000",
      category: "non_food",
    },
  });
  const id = (create.json() as { id: string }).id;
  await waitFor(async () => (await app.inject({ method: "GET", url: `/v1/vendor/registrations/${id}`, headers: hdr() })).statusCode === 200);

  if (status === "submitted") {
    await app.inject({ method: "POST", url: `/v1/vendor/registrations/${id}/submit`, headers: hdr() });
    await drainQueue();
  }
  return id;
}

async function registrationStatus(id: string): Promise<string> {
  return (await app.inject({ method: "GET", url: `/v1/vendor/registrations/${id}`, headers: hdr() })).json().data.status;
}

describe("committee review pipeline", () => {
  it("runs the full assign -> complete -> allocate -> decide(approved) pipeline and persists final registration status", async () => {
    const regId = await createRegistration("submitted");

    const assign = await app.inject({
      method: "POST",
      url: "/v1/vendor/committee/reviews",
      headers: hdr(),
      payload: { registrationId: regId, committeeType: "town_vending_committee" },
    });
    expect(assign.statusCode).toBe(202);
    await drainQueue();
    expect(await registrationStatus(regId)).toBe("under_review");

    const reviewId = (assign.json() as { id: string }).id;
    const complete = await app.inject({
      method: "POST",
      url: `/v1/vendor/committee/reviews/${reviewId}/complete`,
      headers: hdr(),
      payload: { findings: { note: "site inspected" }, recommendation: "allocate_zone" },
    });
    expect(complete.statusCode).toBe(202);
    await drainQueue();

    const allocate = await app.inject({
      method: "POST",
      url: "/v1/vendor/committee/allocate-zone",
      headers: hdr(),
      payload: { registrationId: regId, zone: "Zone 7", spot: "S-14" },
    });
    expect(allocate.statusCode).toBe(202);
    await drainQueue();
    expect(await registrationStatus(regId)).toBe("zone_allocated");

    const decide = await app.inject({
      method: "POST",
      url: "/v1/vendor/committee/decide",
      headers: hdr(),
      payload: { registrationId: regId, decision: "approved" },
    });
    expect(decide.statusCode).toBe(202);
    await drainQueue();
    expect(await registrationStatus(regId)).toBe("approved");
  });

  it("rejects assigning a committee review to a draft registration (not yet submitted)", async () => {
    const regId = await createRegistration("draft");
    const assign = await app.inject({
      method: "POST",
      url: "/v1/vendor/committee/reviews",
      headers: hdr(),
      payload: { registrationId: regId, committeeType: "zone_committee" },
    });
    expect(assign.statusCode).toBe(422);
  });

  it("rejects assigning a committee review to a registration that does not exist", async () => {
    const assign = await app.inject({
      method: "POST",
      url: "/v1/vendor/committee/reviews",
      headers: hdr(),
      payload: { registrationId: randomUUID(), committeeType: "zone_committee" },
    });
    expect(assign.statusCode).toBe(404);
  });

  it("rejects rejecting a registration with no reason supplied", async () => {
    const regId = await createRegistration("submitted");
    const decide = await app.inject({
      method: "POST",
      url: "/v1/vendor/committee/decide",
      headers: hdr(),
      payload: { registrationId: regId, decision: "rejected" },
    });
    expect(decide.statusCode).toBe(422);
  });
});
