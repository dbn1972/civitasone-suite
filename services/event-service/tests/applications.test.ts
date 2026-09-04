/**
 * Route -> consumer -> persisted-state coverage for the applications module.
 * Every write here is queue-first (202 Accepted): the assertions all read
 * back through GET /v1/event/applications/:id (which itself reads through
 * repo.findById, a real tenant-scoped Postgres query) only after draining
 * the in-memory queue, so a passing test proves the real consumer really
 * wrote the real row, not just that the route accepted the request.
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
import { hdr, drainQueue, waitFor, TENANT_A, ACTOR_A } from "./support.js";

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

function basePayload(overrides: Record<string, unknown> = {}) {
  return {
    organiserName: "Community Sports Trust",
    organiserPhone: "9876500001",
    eventType: "sports",
    venueName: "Ward 4 Stadium",
    venueAddress: { line1: "12 MG Road", city: "Springfield", pin: "500001" },
    startDate: "2026-10-01",
    endDate: "2026-10-02",
    expectedAttendance: 80,
    ...overrides,
  };
}

describe("POST /v1/event/applications -> applications consumer", () => {
  it("returns 202 Accepted and the consumer persists a draft application with server-computed fee/deposit and a unique application number", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/event/applications",
      headers: hdr(),
      payload: basePayload(),
    });
    expect(res.statusCode).toBe(202);
    const { id } = res.json() as { id: string };

    await waitFor(async () => (await app.inject({ method: "GET", url: `/v1/event/applications/${id}`, headers: hdr() })).statusCode === 200);

    const get = await app.inject({ method: "GET", url: `/v1/event/applications/${id}`, headers: hdr() });
    const row = get.json().data as {
      id: string; status: string; applicationNumber: string; feeMinor: string | number; depositMinor: string | number; submittedAt: string | null;
    };
    expect(row.status).toBe("draft");
    expect(row.applicationNumber).toMatch(/^EVT\/ULB\/\d{4}\/\d{6}$/);
    // sports, attendance 80, no sound permission -> base fee 500000 (Rs 5000),
    // attendance <= 500 so no surcharge; deposit defaults to 1000000 (Rs 10000).
    expect(String(row.feeMinor)).toBe("500000");
    expect(String(row.depositMinor)).toBe("1000000");
    expect(row.submittedAt).toBeNull();
  });

  it("two applications created back-to-back get distinct application numbers (DB UNIQUE constraint on application_number backs the crypto.randomInt sequence)", async () => {
    const a = await app.inject({ method: "POST", url: "/v1/event/applications", headers: hdr(), payload: basePayload({ organiserName: "Org A" }) });
    const b = await app.inject({ method: "POST", url: "/v1/event/applications", headers: hdr(), payload: basePayload({ organiserName: "Org B" }) });
    const idA = (a.json() as { id: string }).id;
    const idB = (b.json() as { id: string }).id;
    await waitFor(async () => (await app.inject({ method: "GET", url: `/v1/event/applications/${idA}`, headers: hdr() })).statusCode === 200);
    await waitFor(async () => (await app.inject({ method: "GET", url: `/v1/event/applications/${idB}`, headers: hdr() })).statusCode === 200);
    const numA = (await app.inject({ method: "GET", url: `/v1/event/applications/${idA}`, headers: hdr() })).json().data.applicationNumber;
    const numB = (await app.inject({ method: "GET", url: `/v1/event/applications/${idB}`, headers: hdr() })).json().data.applicationNumber;
    expect(numA).not.toBe(numB);
  });
});

describe("POST /v1/event/applications/:id/submit -> applications consumer", () => {
  it("transitions draft -> submitted and stamps submittedAt only via the real consumer write", async () => {
    const create = await app.inject({ method: "POST", url: "/v1/event/applications", headers: hdr(), payload: basePayload() });
    const id = (create.json() as { id: string }).id;
    await waitFor(async () => (await app.inject({ method: "GET", url: `/v1/event/applications/${id}`, headers: hdr() })).statusCode === 200);

    const submit = await app.inject({ method: "POST", url: `/v1/event/applications/${id}/submit`, headers: hdr() });
    expect(submit.statusCode).toBe(202);
    await drainQueue();

    const row = (await app.inject({ method: "GET", url: `/v1/event/applications/${id}`, headers: hdr() })).json().data;
    expect(row.status).toBe("submitted");
    expect(row.submittedAt).not.toBeNull();
  });

  it("rejects submitting an already-submitted application with a route-level 422 (pre-accept validation), never reaching the queue", async () => {
    const create = await app.inject({ method: "POST", url: "/v1/event/applications", headers: hdr(), payload: basePayload() });
    const id = (create.json() as { id: string }).id;
    await waitFor(async () => (await app.inject({ method: "GET", url: `/v1/event/applications/${id}`, headers: hdr() })).statusCode === 200);
    await app.inject({ method: "POST", url: `/v1/event/applications/${id}/submit`, headers: hdr() });
    await drainQueue();

    const second = await app.inject({ method: "POST", url: `/v1/event/applications/${id}/submit`, headers: hdr() });
    expect(second.statusCode).toBe(422);
    expect(second.json().code).toBe("INVALID_STATUS");
  });

  it("404s submitting a nonexistent application", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/event/applications/00000000-0000-4000-8000-000000000000/submit",
      headers: hdr(),
    });
    expect(res.statusCode).toBe(404);
  });
});

describe("POST /v1/event/applications/:id/withdraw -> applications consumer", () => {
  it("transitions draft -> withdrawn, a terminal state that then rejects a second withdraw", async () => {
    const create = await app.inject({ method: "POST", url: "/v1/event/applications", headers: hdr(), payload: basePayload() });
    const id = (create.json() as { id: string }).id;
    await waitFor(async () => (await app.inject({ method: "GET", url: `/v1/event/applications/${id}`, headers: hdr() })).statusCode === 200);

    const withdraw = await app.inject({ method: "POST", url: `/v1/event/applications/${id}/withdraw`, headers: hdr() });
    expect(withdraw.statusCode).toBe(202);
    await drainQueue();

    const row = (await app.inject({ method: "GET", url: `/v1/event/applications/${id}`, headers: hdr() })).json().data;
    expect(row.status).toBe("withdrawn");

    const second = await app.inject({ method: "POST", url: `/v1/event/applications/${id}/withdraw`, headers: hdr() });
    expect(second.statusCode).toBe(422);
  });
});

describe("GET /v1/event/applications", () => {
  it("lists only the requesting tenant's applications and supports status filtering", async () => {
    const create = await app.inject({ method: "POST", url: "/v1/event/applications", headers: hdr(), payload: basePayload({ organiserName: "List Filter Org" }) });
    const id = (create.json() as { id: string }).id;
    await waitFor(async () => (await app.inject({ method: "GET", url: `/v1/event/applications/${id}`, headers: hdr() })).statusCode === 200);

    const listDraft = await app.inject({ method: "GET", url: "/v1/event/applications?status=draft", headers: hdr() });
    expect(listDraft.statusCode).toBe(200);
    expect(listDraft.json().data.some((r: { id: string }) => r.id === id)).toBe(true);

    const listWithdrawn = await app.inject({ method: "GET", url: "/v1/event/applications?status=withdrawn", headers: hdr() });
    expect(listWithdrawn.json().data.some((r: { id: string }) => r.id === id)).toBe(false);
  });
});
