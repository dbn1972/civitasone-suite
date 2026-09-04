/**
 * records module (service register) — route -> consumer -> persisted-state
 * lifecycle, plus pre-accept existence checks for bookingId/facilityId.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { registerFacilityConsumers } from "../src/modules/facilities/consumer.js";
import { registerBookingConsumers } from "../src/modules/bookings/consumer.js";
import { registerRecordConsumers } from "../src/modules/records/consumer.js";
import { hdr, waitFor, drainQueue, ADMIN_ROLES, CITIZEN_ROLES, TENANT_A, ACTOR_A } from "./support.js";

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
  registerFacilityConsumers(queue);
  registerBookingConsumers(queue);
  registerRecordConsumers(queue);
  await queue.start();
});

afterAll(async () => {
  await app.close();
  await sqlClient.end();
});

async function createActiveFacility(): Promise<string> {
  const create = await app.inject({
    method: "POST",
    url: "/v1/crematorium/facilities",
    headers: hdr(ACTOR_A, TENANT_A, ADMIN_ROLES),
    payload: { facilityName: "Records Test Facility", facilityType: "crematorium", address: { line1: "1 Test St", city: "Pune", pin: "411001" }, totalSlots: 4 },
  });
  const id = (create.json() as { id: string }).id;
  await waitFor(async () => (await app.inject({ method: "GET", url: `/v1/crematorium/facilities/${id}`, headers: hdr(ACTOR_A, TENANT_A, ADMIN_ROLES) })).statusCode === 200);
  return id;
}

async function createBooking(facilityId: string): Promise<string> {
  const create = await app.inject({
    method: "POST",
    url: "/v1/crematorium/bookings",
    headers: hdr(ACTOR_A, TENANT_A, CITIZEN_ROLES),
    payload: { facilityId, applicantName: "Test Applicant", applicantPhone: "9876543210", deceasedName: "Test Deceased", serviceType: "cremation", requestedDate: "2027-03-01" },
  });
  const id = (create.json() as { id: string }).id;
  await waitFor(async () => (await app.inject({ method: "GET", url: `/v1/crematorium/bookings/${id}`, headers: hdr(ACTOR_A, TENANT_A, ADMIN_ROLES) })).statusCode === 200);
  return id;
}

describe("records — route -> consumer -> persisted state", () => {
  it("create: publishes 202, consumer persists a service-register row tied to the booking and facility", async () => {
    const facilityId = await createActiveFacility();
    const bookingId = await createBooking(facilityId);

    const create = await app.inject({
      method: "POST",
      url: "/v1/crematorium/records",
      headers: hdr(ACTOR_A, TENANT_A, ADMIN_ROLES),
      payload: { bookingId, facilityId, serviceDate: "2027-03-02", serviceType: "cremation", notes: "Completed without incident" },
    });
    expect(create.statusCode).toBe(202);
    const id = (create.json() as { id: string }).id;

    let row: { bookingId: string; facilityId: string; performedBy: string } | undefined;
    await waitFor(async () => {
      const list = await app.inject({ method: "GET", url: `/v1/crematorium/facilities/${facilityId}/records`, headers: hdr(ACTOR_A, TENANT_A, ADMIN_ROLES) });
      row = list.json().data.find((r: { id: string }) => r.id === id);
      return row !== undefined;
    });
    expect(row!.bookingId).toBe(bookingId);
    expect(row!.facilityId).toBe(facilityId);
    expect(row!.performedBy).toBe(ACTOR_A);
  });

  it("create is rejected pre-accept when bookingId does not exist, never reaches the consumer", async () => {
    const facilityId = await createActiveFacility();
    const create = await app.inject({
      method: "POST",
      url: "/v1/crematorium/records",
      headers: hdr(ACTOR_A, TENANT_A, ADMIN_ROLES),
      payload: { bookingId: "00000000-0000-0000-0000-000000000000", facilityId, serviceDate: "2027-03-02", serviceType: "cremation" },
    });
    expect(create.statusCode).toBe(404);
    await drainQueue();
  });

  it("create is rejected pre-accept when facilityId does not exist, never reaches the consumer", async () => {
    const facilityId = await createActiveFacility();
    const bookingId = await createBooking(facilityId);
    const create = await app.inject({
      method: "POST",
      url: "/v1/crematorium/records",
      headers: hdr(ACTOR_A, TENANT_A, ADMIN_ROLES),
      payload: { bookingId, facilityId: "00000000-0000-0000-0000-000000000000", serviceDate: "2027-03-02", serviceType: "cremation" },
    });
    expect(create.statusCode).toBe(404);
    await drainQueue();
  });

  it("a plain crematorium_user cannot create a record (ADMIN_ROLES only)", async () => {
    const facilityId = await createActiveFacility();
    const bookingId = await createBooking(facilityId);
    const create = await app.inject({
      method: "POST",
      url: "/v1/crematorium/records",
      headers: hdr(ACTOR_A, TENANT_A, CITIZEN_ROLES),
      payload: { bookingId, facilityId, serviceDate: "2027-03-02", serviceType: "cremation" },
    });
    expect(create.statusCode).toBe(403);
  });
});
