/**
 * registrations — withdrawal, and the at-least-once delivery contract of the
 * consumers: a redelivered command (same messageId) must be a no-op, and a
 * command for a registration that does not match tenant+id must not record
 * anything. Same live-DB convention as registrations.test.ts.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { COMMANDS } from "../src/topics.js";
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

async function draftRegistration(aadhaar: string): Promise<string> {
  const create = await app.inject({
    method: "POST",
    url: "/v1/vendor/registrations",
    headers: hdr(ACTOR_A, TENANT_A, ["vendor_user"]),
    payload: { vendorName: "Withdrawal Test Vendor", vendorAadhaar: aadhaar, vendorPhone: "9876500222", category: "service" },
  });
  const id = (create.json() as { id: string }).id;
  await waitFor(async () => (await app.inject({ method: "GET", url: `/v1/vendor/registrations/${id}`, headers: hdr() })).statusCode === 200);
  return id;
}

async function registration(id: string): Promise<{ status: string; updatedAt: string }> {
  return (await app.inject({ method: "GET", url: `/v1/vendor/registrations/${id}`, headers: hdr() })).json().data;
}

function command(type: string, messageId: string, payload: Record<string, unknown>) {
  return {
    messageId,
    type,
    tenantId: TENANT_A,
    actorId: ACTOR_A,
    correlationId: randomUUID(),
    schemaVersion: "1.0",
    payload: { ...payload, tenantId: TENANT_A },
  };
}

describe("registration withdrawal", () => {
  it("withdraws a draft registration and then refuses to withdraw or submit it", async () => {
    const id = await draftRegistration("123456789401");

    const withdraw = await app.inject({ method: "POST", url: `/v1/vendor/registrations/${id}/withdraw`, headers: hdr() });
    expect(withdraw.statusCode).toBe(202);
    await drainQueue();
    expect((await registration(id)).status).toBe("withdrawn");

    const again = await app.inject({ method: "POST", url: `/v1/vendor/registrations/${id}/withdraw`, headers: hdr() });
    expect(again.statusCode).toBe(422);
    expect(again.json().code).toBe("INVALID_STATUS");

    const submit = await app.inject({ method: "POST", url: `/v1/vendor/registrations/${id}/submit`, headers: hdr() });
    expect(submit.statusCode).toBe(422);
  });

  it("403s a role outside the vendor roles, and a vendor_user on an admin-only committee route", async () => {
    const id = await draftRegistration("123456789404");

    const outsider = await app.inject({ method: "POST", url: `/v1/vendor/registrations/${id}/withdraw`, headers: hdr(ACTOR_A, TENANT_A, ["citizen"]) });
    expect(outsider.statusCode).toBe(403);
    expect(outsider.json().code).toBe("FORBIDDEN");
    // The refused request changed nothing.
    expect((await registration(id)).status).toBe("draft");

    const vendorOnAdminRoute = await app.inject({
      method: "POST",
      url: "/v1/vendor/committee/decide",
      headers: hdr(ACTOR_A, TENANT_A, ["vendor_user"]),
      payload: { registrationId: id, decision: "approved" },
    });
    expect(vendorOnAdminRoute.statusCode).toBe(403);
  });

  it("404s withdrawing a registration that does not exist", async () => {
    const res = await app.inject({ method: "POST", url: `/v1/vendor/registrations/${randomUUID()}/withdraw`, headers: hdr() });
    expect(res.statusCode).toBe(404);
  });
});

describe("registration consumers — at-least-once delivery", () => {
  it("applies a redelivered withdraw command (same messageId) only once", async () => {
    const id = await draftRegistration("123456789402");
    const messageId = randomUUID();

    await queue.publish(COMMANDS.withdrawRegistration, command(COMMANDS.withdrawRegistration, messageId, { id }));
    await drainQueue();
    const afterFirst = await registration(id);
    expect(afterFirst.status).toBe("withdrawn");

    await queue.publish(COMMANDS.withdrawRegistration, command(COMMANDS.withdrawRegistration, messageId, { id }));
    await drainQueue();
    const afterSecond = await registration(id);
    expect(afterSecond.status).toBe("withdrawn");
    expect(afterSecond.updatedAt).toBe(afterFirst.updatedAt);
  });

  it("applies a redelivered submit command (same messageId) only once", async () => {
    const id = await draftRegistration("123456789403");
    const messageId = randomUUID();

    await queue.publish(COMMANDS.submitRegistration, command(COMMANDS.submitRegistration, messageId, { id }));
    await drainQueue();
    const afterFirst = await registration(id);
    expect(afterFirst.status).toBe("submitted");

    await queue.publish(COMMANDS.submitRegistration, command(COMMANDS.submitRegistration, messageId, { id }));
    await drainQueue();
    expect((await registration(id)).updatedAt).toBe(afterFirst.updatedAt);
  });

  it("ignores a withdraw command for a registration id that matches no row", async () => {
    const ghost = randomUUID();
    await queue.publish(
      COMMANDS.withdrawRegistration,
      command(COMMANDS.withdrawRegistration, randomUUID(), { id: ghost }),
    );
    await drainQueue();
    // No row is invented for the id (and the consumer did not throw): it is still absent.
    const res = await app.inject({ method: "GET", url: `/v1/vendor/registrations/${ghost}`, headers: hdr() });
    expect(res.statusCode).toBe(404);
  });
});
