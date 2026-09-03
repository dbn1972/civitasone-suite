/**
 * collection module — route + consumer smoke tests.
 *
 * Covers the collection-request lifecycle (request -> schedule -> complete,
 * and the cancel branch), the field-task lifecycle, and — the reason this
 * file exists — the missing synchronous pre-accept transition check on
 * POST /v1/swm/field-tasks/:id/complete that src/modules/collection/routes.ts
 * had before this PR.
 *
 * Every other F3 write route in this service (complaint assign/resolve/close,
 * bulk-generator suspend, collection-request schedule/complete/cancel,
 * hotspot resolve) calls its module's validate*Transition() synchronously
 * before returning 202, so an invalid transition is rejected up front instead
 * of being silently accepted and then silently dropped (or worse, silently
 * applied) by the async consumer, which only checks the optimistic-lock
 * version — not the domain transition. The field-task /complete route was
 * the one exception: it checked version but never called
 * validateTaskTransition(existing.status, "completed"), so a task could be
 * "completed" directly from "assigned" (skipping "in_progress") and 202
 * would lie about it having been accepted as a valid transition.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { registerCollectionConsumers } from "../src/modules/collection/consumer.js";
import { hdr, waitFor, TENANT_A, ACTOR_A } from "./support.js";

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
  registerCollectionConsumers(queue);
  await queue.start();
});

afterAll(async () => {
  await app.close();
  await sqlClient.end();
});

async function createRequest(): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: "/v1/swm/collection-requests",
    headers: hdr(ACTOR_A, TENANT_A, ["swm_user"]),
    payload: { wasteType: "bulky_item", estimatedQuantity: "2 sofas" },
  });
  expect(res.statusCode).toBe(202);
  const id = (res.json() as { id: string }).id;
  await waitFor(async () => {
    const get = await app.inject({ method: "GET", url: `/v1/swm/collection-requests/${id}`, headers: hdr() });
    return get.statusCode === 200;
  });
  return id;
}

async function createFieldTask(): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: "/v1/swm/field-tasks",
    headers: hdr(ACTOR_A, TENANT_A, ["swm_admin"]),
    payload: { routeId: "route-7", zoneId: "zone-3" },
  });
  expect(res.statusCode).toBe(202);
  const id = (res.json() as { id: string }).id;
  await waitFor(async () => {
    const get = await app.inject({ method: "GET", url: `/v1/swm/field-tasks/${id}`, headers: hdr() });
    return get.statusCode === 200;
  });
  return id;
}

describe("collection-request lifecycle: request -> schedule -> complete", () => {
  it("walks the happy path and marks the fee paid on completion", async () => {
    const id = await createRequest();
    let get = await app.inject({ method: "GET", url: `/v1/swm/collection-requests/${id}`, headers: hdr() });
    expect(get.json().data.status).toBe("requested");

    const schedule = await app.inject({
      method: "POST",
      url: `/v1/swm/collection-requests/${id}/schedule`,
      headers: hdr(),
      payload: { vehicleId: "TRUCK-12", version: 1 },
    });
    expect(schedule.statusCode).toBe(202);
    await waitFor(async () => {
      get = await app.inject({ method: "GET", url: `/v1/swm/collection-requests/${id}`, headers: hdr() });
      return get.json().data.status === "scheduled";
    });

    const complete = await app.inject({
      method: "POST",
      url: `/v1/swm/collection-requests/${id}/complete`,
      headers: hdr(),
      payload: { version: 2 },
    });
    expect(complete.statusCode).toBe(202);
    await waitFor(async () => {
      get = await app.inject({ method: "GET", url: `/v1/swm/collection-requests/${id}`, headers: hdr() });
      return get.json().data.status === "collected";
    });
    expect(get.json().data.feePaid).toBe(true);

    // collected is terminal — cancel is rejected
    const cancel = await app.inject({
      method: "POST",
      url: `/v1/swm/collection-requests/${id}/cancel`,
      headers: hdr(),
      payload: { version: 3 },
    });
    expect(cancel.statusCode).toBe(422);
  });

  it("can be cancelled directly from requested", async () => {
    const id = await createRequest();
    const cancel = await app.inject({
      method: "POST",
      url: `/v1/swm/collection-requests/${id}/cancel`,
      headers: hdr(),
      payload: { version: 1 },
    });
    expect(cancel.statusCode).toBe(202);
    await waitFor(async () => {
      const get = await app.inject({ method: "GET", url: `/v1/swm/collection-requests/${id}`, headers: hdr() });
      return get.json().data.status === "cancelled";
    });
  });
});

describe("field-task /complete — transition-validation regression (bug fix)", () => {
  it("rejects completing a freshly-created task (assigned -> completed skips in_progress)", async () => {
    const id = await createFieldTask();
    const get = await app.inject({ method: "GET", url: `/v1/swm/field-tasks/${id}`, headers: hdr() });
    expect(get.json().data.status).toBe("assigned");

    const complete = await app.inject({
      method: "POST",
      url: `/v1/swm/field-tasks/${id}/complete`,
      headers: hdr(ACTOR_A, TENANT_A, ["swm_user"]),
      payload: { version: 1 },
    });

    // Before the fix this returned 202 (accepted) and the consumer applied an
    // invalid assigned -> completed transition with no domain check at all.
    expect(complete.statusCode).toBe(422);
    expect(complete.json().code).toBe("TRANSITION_INVALID");

    // And the row was never mutated by the (rejected) attempt.
    const after = await app.inject({ method: "GET", url: `/v1/swm/field-tasks/${id}`, headers: hdr() });
    expect(after.json().data.status).toBe("assigned");
    expect(after.json().data.version).toBe(1);
  });

  it("404s on an unknown field task id", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/swm/field-tasks/00000000-0000-4000-8000-000000000000/complete",
      headers: hdr(),
      payload: { version: 1 },
    });
    expect(res.statusCode).toBe(404);
  });
});
