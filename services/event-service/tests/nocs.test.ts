/**
 * Route -> consumer -> persisted-state coverage for the NOC (no-objection
 * certificate) module, plus the pre-accept validation that closed a real
 * gap: requesting a NOC against a nonexistent (or cross-tenant) application
 * used to succeed unconditionally, since no FK exists at the schema level.
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
import { hdr, drainQueue, waitFor, TENANT_A, TENANT_B } from "./support.js";

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

async function createSubmittedApplication(tenant = TENANT_A): Promise<string> {
  const create = await app.inject({
    method: "POST",
    url: "/v1/event/applications",
    headers: hdr(undefined, tenant),
    payload: {
      organiserName: "NOC Test Org",
      organiserPhone: "9876500002",
      eventType: "sports",
      venueName: "Test Ground",
      venueAddress: { line1: "1 Test St", city: "Springfield", pin: "500001" },
      startDate: "2026-10-01",
      endDate: "2026-10-02",
      expectedAttendance: 80,
    },
  });
  const id = (create.json() as { id: string }).id;
  await waitFor(async () => (await app.inject({ method: "GET", url: `/v1/event/applications/${id}`, headers: hdr(undefined, tenant) })).statusCode === 200);
  return id;
}

describe("POST /v1/event/nocs -> nocs consumer", () => {
  it("creates a requested NOC once the referenced application really exists", async () => {
    const applicationId = await createSubmittedApplication();
    const res = await app.inject({
      method: "POST",
      url: "/v1/event/nocs",
      headers: hdr(),
      payload: { applicationId, department: "police" },
    });
    expect(res.statusCode).toBe(202);
    const { id } = res.json() as { id: string };

    await waitFor(async () => (await app.inject({ method: "GET", url: `/v1/event/nocs?applicationId=${applicationId}`, headers: hdr() })).json().data.length > 0);
    const list = await app.inject({ method: "GET", url: `/v1/event/nocs?applicationId=${applicationId}`, headers: hdr() });
    const row = list.json().data.find((r: { id: string }) => r.id === id);
    expect(row).toBeDefined();
    expect(row.status).toBe("requested");
    expect(row.department).toBe("police");
  });

  it("rejects a NOC request for a nonexistent applicationId with a route-level 404, never reaching the queue", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/event/nocs",
      headers: hdr(),
      payload: { applicationId: "00000000-0000-4000-8000-000000000000", department: "police" },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe("APPLICATION_NOT_FOUND");
  });

  it("rejects a NOC request whose applicationId belongs to a different tenant (cross-tenant reference), same 404", async () => {
    const applicationId = await createSubmittedApplication(TENANT_A);
    const res = await app.inject({
      method: "POST",
      url: "/v1/event/nocs",
      headers: hdr(undefined, TENANT_B),
      payload: { applicationId, department: "police" },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe("POST /v1/event/nocs/:id/respond -> nocs consumer", () => {
  it("approves a requested NOC and persists the officer's decision", async () => {
    const applicationId = await createSubmittedApplication();
    const create = await app.inject({ method: "POST", url: "/v1/event/nocs", headers: hdr(), payload: { applicationId, department: "fire" } });
    const nocId = (create.json() as { id: string }).id;
    await waitFor(async () => (await app.inject({ method: "GET", url: `/v1/event/nocs?applicationId=${applicationId}`, headers: hdr() })).json().data.some((r: { id: string }) => r.id === nocId));

    const respond = await app.inject({
      method: "POST",
      url: `/v1/event/nocs/${nocId}/respond`,
      headers: hdr(),
      payload: { status: "approved", conditions: { maxDecibels: 80 } },
    });
    expect(respond.statusCode).toBe(202);
    await drainQueue();

    const list = await app.inject({ method: "GET", url: `/v1/event/nocs?applicationId=${applicationId}`, headers: hdr() });
    const row = list.json().data.find((r: { id: string }) => r.id === nocId);
    expect(row.status).toBe("approved");
    expect(row.conditions).toEqual({ maxDecibels: 80 });
    expect(row.respondedAt).not.toBeNull();
  });

  it("a second response to an already-responded NOC is rejected at the route (422) and does not overwrite the first decision", async () => {
    const applicationId = await createSubmittedApplication();
    const create = await app.inject({ method: "POST", url: "/v1/event/nocs", headers: hdr(), payload: { applicationId, department: "health" } });
    const nocId = (create.json() as { id: string }).id;
    await waitFor(async () => (await app.inject({ method: "GET", url: `/v1/event/nocs?applicationId=${applicationId}`, headers: hdr() })).json().data.some((r: { id: string }) => r.id === nocId));
    await app.inject({ method: "POST", url: `/v1/event/nocs/${nocId}/respond`, headers: hdr(), payload: { status: "approved" } });
    await drainQueue();

    const second = await app.inject({ method: "POST", url: `/v1/event/nocs/${nocId}/respond`, headers: hdr(), payload: { status: "rejected" } });
    expect(second.statusCode).toBe(422);
    expect(second.json().code).toBe("ALREADY_RESPONDED");

    const list = await app.inject({ method: "GET", url: `/v1/event/nocs?applicationId=${applicationId}`, headers: hdr() });
    expect(list.json().data.find((r: { id: string }) => r.id === nocId).status).toBe("approved");
  });
});
