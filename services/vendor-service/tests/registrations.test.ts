/**
 * registrations module — live end-to-end proof (real Postgres + real HTTP
 * routes + real consumers) of the create -> submit -> withdraw flow, the
 * server-computed fee, and the sequence-based (non-collidable) registration
 * number (see tests/number-sequences.test.ts for the concurrency proof).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { registerRegistrationConsumers } from "../src/modules/registrations/consumer.js";
import { hdr, drainQueue, waitFor, TENANT_A, ACTOR_A } from "./support.js";

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
  registerRegistrationConsumers(queue);
  await queue.start();
});

afterAll(async () => {
  await app.close();
  await sqlClient.end();
});

async function createRegistration(): Promise<{ id: string }> {
  const res = await app.inject({
    method: "POST",
    url: "/v1/vendor/registrations",
    headers: hdr(ACTOR_A, TENANT_A, ["vendor_user"]),
    payload: {
      vendorName: "Priya's Chaat Stall",
      vendorAadhaar: "123456789012",
      vendorPhone: "9876543210",
      category: "food",
      preferredZone: "Zone 4",
    },
  });
  expect(res.statusCode).toBe(202);
  const body = res.json() as { id: string };
  await waitFor(async () => {
    const get = await app.inject({ method: "GET", url: `/v1/vendor/registrations/${body.id}`, headers: hdr() });
    return get.statusCode === 200;
  });
  return { id: body.id };
}

describe("registration lifecycle", () => {
  it("creates, persists a server-computed fee and a real (non-collidable) registration number", async () => {
    const { id } = await createRegistration();
    const get = (await app.inject({ method: "GET", url: `/v1/vendor/registrations/${id}`, headers: hdr() })).json().data;
    expect(get.status).toBe("draft");
    expect(get.feeMinor).toBe("100000"); // food category, see domain.ts calculateFeeMinor
    expect(get.registrationNumber).toMatch(/^VEND\/ULB\/\d{4}\/\d{6}$/);
  });

  it("submits a draft registration, then withdraws it", async () => {
    const { id } = await createRegistration();

    const submit = await app.inject({
      method: "POST",
      url: `/v1/vendor/registrations/${id}/submit`,
      headers: hdr(ACTOR_A, TENANT_A, ["vendor_user"]),
    });
    expect(submit.statusCode).toBe(202);
    await drainQueue();
    const afterSubmit = (await app.inject({ method: "GET", url: `/v1/vendor/registrations/${id}`, headers: hdr() })).json().data;
    expect(afterSubmit.status).toBe("submitted");
    expect(afterSubmit.version).toBe(2);

    const withdraw = await app.inject({
      method: "POST",
      url: `/v1/vendor/registrations/${id}/withdraw`,
      headers: hdr(ACTOR_A, TENANT_A, ["vendor_user"]),
    });
    expect(withdraw.statusCode).toBe(202);
    await drainQueue();
    const afterWithdraw = (await app.inject({ method: "GET", url: `/v1/vendor/registrations/${id}`, headers: hdr() })).json().data;
    expect(afterWithdraw.status).toBe("withdrawn");
  });

  it("rejects submitting an already-submitted registration (pre-accept status guard)", async () => {
    const { id } = await createRegistration();
    await app.inject({ method: "POST", url: `/v1/vendor/registrations/${id}/submit`, headers: hdr() });
    await drainQueue();

    const secondSubmit = await app.inject({ method: "POST", url: `/v1/vendor/registrations/${id}/submit`, headers: hdr() });
    expect(secondSubmit.statusCode).toBe(422);
  });

  it("rejects withdrawing a registration that was never created (404, not 422/500)", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/vendor/registrations/${randomUUID()}/withdraw`,
      headers: hdr(),
    });
    expect(res.statusCode).toBe(404);
  });
});
