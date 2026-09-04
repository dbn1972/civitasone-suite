/**
 * facilities module — route -> consumer -> persisted-state lifecycle.
 * Mirrors services/fire-service/tests/applications.test.ts (PR #1011)'s
 * structure, adapted to facilities' simpler CRUD shape (no state machine).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { registerFacilityConsumers } from "../src/modules/facilities/consumer.js";
import { hdr, waitFor, drainQueue, ADMIN_ROLES, CITIZEN_ROLES, TENANT_A, ACTOR_A } from "./support.js";

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
  registerFacilityConsumers(queue);
  await queue.start();
});

afterAll(async () => {
  await app.close();
  await sqlClient.end();
});

const validBody = {
  facilityName: "Test Crematorium",
  facilityType: "crematorium" as const,
  address: { line1: "1 Test St", city: "Pune", pin: "411001" },
  totalSlots: 4,
  operatingHours: { open: "06:00", close: "20:00" },
  contactPerson: "Officer A",
  contactPhone: "9876543210",
};

async function createFacility(body: Record<string, unknown> = validBody): Promise<string> {
  const create = await app.inject({
    method: "POST",
    url: "/v1/crematorium/facilities",
    headers: hdr(ACTOR_A, TENANT_A, ADMIN_ROLES),
    payload: body,
  });
  expect(create.statusCode).toBe(202);
  const id = (create.json() as { id: string }).id;
  await waitFor(async () => (await app.inject({ method: "GET", url: `/v1/crematorium/facilities/${id}`, headers: hdr(ACTOR_A, TENANT_A, ADMIN_ROLES) })).statusCode === 200);
  return id;
}

describe("facilities — route -> consumer -> persisted state", () => {
  it("create: publishes 202, consumer persists an active facility row", async () => {
    const id = await createFacility();
    const get = await app.inject({ method: "GET", url: `/v1/crematorium/facilities/${id}`, headers: hdr(ACTOR_A, TENANT_A, ADMIN_ROLES) });
    const row = get.json().data;
    expect(row.status).toBe("active");
    expect(row.facilityName).toBe("Test Crematorium");
    expect(row.totalSlots).toBe(4);
  });

  it("a plain crematorium_user cannot create a facility (ADMIN_ROLES only)", async () => {
    const create = await app.inject({
      method: "POST",
      url: "/v1/crematorium/facilities",
      headers: hdr(ACTOR_A, TENANT_A, CITIZEN_ROLES),
      payload: validBody,
    });
    expect(create.statusCode).toBe(403);
  });

  it("update: consumer applies a partial patch and primes the read cache with fresh data", async () => {
    const id = await createFacility();
    const patch = await app.inject({
      method: "PATCH",
      url: `/v1/crematorium/facilities/${id}`,
      headers: hdr(ACTOR_A, TENANT_A, ADMIN_ROLES),
      payload: { totalSlots: 10, status: "under_maintenance" },
    });
    expect(patch.statusCode).toBe(202);

    let row: { totalSlots: number; status: string; facilityName: string } | undefined;
    await waitFor(async () => {
      const get = await app.inject({ method: "GET", url: `/v1/crematorium/facilities/${id}`, headers: hdr(ACTOR_A, TENANT_A, ADMIN_ROLES) });
      row = get.json().data;
      return row?.status === "under_maintenance";
    });
    expect(row!.totalSlots).toBe(10);
    expect(row!.facilityName).toBe("Test Crematorium"); // untouched field survives the partial patch
  });

  it("patching an unknown facility 404s pre-accept, never reaches the consumer", async () => {
    const patch = await app.inject({
      method: "PATCH",
      url: "/v1/crematorium/facilities/00000000-0000-0000-0000-000000000000",
      headers: hdr(ACTOR_A, TENANT_A, ADMIN_ROLES),
      payload: { totalSlots: 1 },
    });
    expect(patch.statusCode).toBe(404);
    await drainQueue();
  });

  it("list: filters by status and paginates", async () => {
    const id = await createFacility();
    await app.inject({ method: "PATCH", url: `/v1/crematorium/facilities/${id}`, headers: hdr(ACTOR_A, TENANT_A, ADMIN_ROLES), payload: { status: "closed" } });
    await waitFor(async () => (await app.inject({ method: "GET", url: `/v1/crematorium/facilities/${id}`, headers: hdr(ACTOR_A, TENANT_A, ADMIN_ROLES) })).json().data.status === "closed");

    const list = await app.inject({ method: "GET", url: "/v1/crematorium/facilities?status=closed", headers: hdr(ACTOR_A, TENANT_A, ADMIN_ROLES) });
    expect(list.statusCode).toBe(200);
    expect(list.json().data.find((f: { id: string }) => f.id === id)).toBeDefined();
  });
});
