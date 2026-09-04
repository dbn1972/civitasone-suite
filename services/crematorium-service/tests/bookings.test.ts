/**
 * bookings module — route -> consumer -> persisted-state lifecycle, plus a
 * direct DB-level proof that repo.ts's updateStatus is a real
 * compare-and-swap (CAS), including under real concurrency. Mirrors
 * services/fire-service/tests/applications.test.ts +
 * number-uniqueness.test.ts (PR #1011).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { runWithTenant } from "@civitasone/db";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { registerFacilityConsumers } from "../src/modules/facilities/consumer.js";
import { registerBookingConsumers } from "../src/modules/bookings/consumer.js";
import * as repo from "../src/modules/bookings/repo.js";
import { hdr, waitFor, drainQueue, ADMIN_ROLES, CITIZEN_ROLES, TENANT_A, TENANT_B, ACTOR_A, ACTOR_B } from "./support.js";

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
  registerFacilityConsumers(queue);
  registerBookingConsumers(queue);
  await queue.start();
});

afterAll(async () => {
  await app.close();
  await sqlClient.end();
});

const facilityBody = {
  facilityName: "Bookings Test Facility",
  facilityType: "crematorium" as const,
  address: { line1: "1 Test St", city: "Pune", pin: "411001" },
  totalSlots: 4,
};

const bookingBody = (facilityId: string) => ({
  facilityId,
  applicantName: "Test Applicant",
  applicantPhone: "9876543210",
  deceasedName: "Test Deceased",
  serviceType: "cremation" as const,
  requestedDate: "2027-03-01",
});

async function createActiveFacility(tenantId = TENANT_A, actor = ACTOR_A): Promise<string> {
  const create = await app.inject({ method: "POST", url: "/v1/crematorium/facilities", headers: hdr(actor, tenantId, ADMIN_ROLES), payload: facilityBody });
  const id = (create.json() as { id: string }).id;
  await waitFor(async () => (await app.inject({ method: "GET", url: `/v1/crematorium/facilities/${id}`, headers: hdr(actor, tenantId, ADMIN_ROLES) })).statusCode === 200);
  return id;
}

describe("bookings — route -> consumer -> persisted state", () => {
  it("create: publishes 202, consumer persists a requested row with a computed fee and a real booking number", async () => {
    const facilityId = await createActiveFacility();
    const create = await app.inject({ method: "POST", url: "/v1/crematorium/bookings", headers: hdr(ACTOR_A, TENANT_A, CITIZEN_ROLES), payload: bookingBody(facilityId) });
    expect(create.statusCode).toBe(202);
    const id = (create.json() as { id: string }).id;

    let row: { status: string; bookingNumber: string; feeMinor: string; feePaid: boolean; createdBy: string } | undefined;
    await waitFor(async () => {
      const get = await app.inject({ method: "GET", url: `/v1/crematorium/bookings/${id}`, headers: hdr(ACTOR_A, TENANT_A, CITIZEN_ROLES) });
      if (get.statusCode !== 200) return false;
      row = get.json().data;
      return true;
    });

    expect(row!.status).toBe("requested");
    expect(row!.feePaid).toBe(false);
    expect(String(row!.feeMinor)).toBe("50000"); // cremation base fee
    expect(row!.bookingNumber).toMatch(/^CREM\/ULB\/\d{4}\/\d{6}$/);
    expect(row!.createdBy).toBe(ACTOR_A);
  });

  it("create is rejected pre-accept when the facility does not exist", async () => {
    const create = await app.inject({
      method: "POST",
      url: "/v1/crematorium/bookings",
      headers: hdr(ACTOR_A, TENANT_A, CITIZEN_ROLES),
      payload: bookingBody("00000000-0000-0000-0000-000000000000"),
    });
    expect(create.statusCode).toBe(404);
    await drainQueue();
  });

  it("create is rejected pre-accept when the facility is under_maintenance, not silently accepted", async () => {
    const facilityId = await createActiveFacility();
    const patch = await app.inject({ method: "PATCH", url: `/v1/crematorium/facilities/${facilityId}`, headers: hdr(ACTOR_A, TENANT_A, ADMIN_ROLES), payload: { status: "under_maintenance" } });
    expect(patch.statusCode).toBe(202);
    await waitFor(async () => (await app.inject({ method: "GET", url: `/v1/crematorium/facilities/${facilityId}`, headers: hdr(ACTOR_A, TENANT_A, ADMIN_ROLES) })).json().data.status === "under_maintenance");

    const create = await app.inject({ method: "POST", url: "/v1/crematorium/bookings", headers: hdr(ACTOR_A, TENANT_A, CITIZEN_ROLES), payload: bookingBody(facilityId) });
    expect(create.statusCode).toBe(422);
    await drainQueue();
  });

  it("confirm: requested -> confirmed, sets slotNumber", async () => {
    const facilityId = await createActiveFacility();
    const create = await app.inject({ method: "POST", url: "/v1/crematorium/bookings", headers: hdr(ACTOR_A, TENANT_A, CITIZEN_ROLES), payload: bookingBody(facilityId) });
    const id = (create.json() as { id: string }).id;
    await waitFor(async () => (await app.inject({ method: "GET", url: `/v1/crematorium/bookings/${id}`, headers: hdr(ACTOR_A, TENANT_A, CITIZEN_ROLES) })).statusCode === 200);

    const confirm = await app.inject({ method: "POST", url: `/v1/crematorium/bookings/${id}/confirm`, headers: hdr(ACTOR_A, TENANT_A, ADMIN_ROLES), payload: { slotNumber: "S-1" } });
    expect(confirm.statusCode).toBe(202);

    let row: { status: string; slotNumber: string | null } | undefined;
    await waitFor(async () => {
      const get = await app.inject({ method: "GET", url: `/v1/crematorium/bookings/${id}`, headers: hdr(ACTOR_A, TENANT_A, CITIZEN_ROLES) });
      row = get.json().data;
      return row?.status === "confirmed";
    });
    expect(row!.slotNumber).toBe("S-1");
  });

  it("a plain crematorium_user cannot confirm a booking (ADMIN_ROLES only)", async () => {
    const facilityId = await createActiveFacility();
    const create = await app.inject({ method: "POST", url: "/v1/crematorium/bookings", headers: hdr(ACTOR_A, TENANT_A, CITIZEN_ROLES), payload: bookingBody(facilityId) });
    const id = (create.json() as { id: string }).id;
    await waitFor(async () => (await app.inject({ method: "GET", url: `/v1/crematorium/bookings/${id}`, headers: hdr(ACTOR_A, TENANT_A, CITIZEN_ROLES) })).statusCode === 200);

    const confirm = await app.inject({ method: "POST", url: `/v1/crematorium/bookings/${id}/confirm`, headers: hdr(ACTOR_A, TENANT_A, CITIZEN_ROLES), payload: { slotNumber: "S-1" } });
    expect(confirm.statusCode).toBe(403);
  });

  it("complete: confirmed -> completed, sets completedAt", async () => {
    const facilityId = await createActiveFacility();
    const create = await app.inject({ method: "POST", url: "/v1/crematorium/bookings", headers: hdr(ACTOR_A, TENANT_A, CITIZEN_ROLES), payload: bookingBody(facilityId) });
    const id = (create.json() as { id: string }).id;
    await waitFor(async () => (await app.inject({ method: "GET", url: `/v1/crematorium/bookings/${id}`, headers: hdr(ACTOR_A, TENANT_A, CITIZEN_ROLES) })).statusCode === 200);
    await app.inject({ method: "POST", url: `/v1/crematorium/bookings/${id}/confirm`, headers: hdr(ACTOR_A, TENANT_A, ADMIN_ROLES), payload: { slotNumber: "S-1" } });
    await waitFor(async () => (await app.inject({ method: "GET", url: `/v1/crematorium/bookings/${id}`, headers: hdr(ACTOR_A, TENANT_A, CITIZEN_ROLES) })).json().data.status === "confirmed");

    const complete = await app.inject({ method: "POST", url: `/v1/crematorium/bookings/${id}/complete`, headers: hdr(ACTOR_A, TENANT_A, ADMIN_ROLES) });
    expect(complete.statusCode).toBe(202);

    let row: { status: string; completedAt: string | null } | undefined;
    await waitFor(async () => {
      const get = await app.inject({ method: "GET", url: `/v1/crematorium/bookings/${id}`, headers: hdr(ACTOR_A, TENANT_A, CITIZEN_ROLES) });
      row = get.json().data;
      return row?.status === "completed";
    });
    expect(row!.completedAt).not.toBeNull();
  });

  it("route pre-check rejects completing a still-requested (unconfirmed) booking with 422", async () => {
    const facilityId = await createActiveFacility();
    const create = await app.inject({ method: "POST", url: "/v1/crematorium/bookings", headers: hdr(ACTOR_A, TENANT_A, CITIZEN_ROLES), payload: bookingBody(facilityId) });
    const id = (create.json() as { id: string }).id;
    await waitFor(async () => (await app.inject({ method: "GET", url: `/v1/crematorium/bookings/${id}`, headers: hdr(ACTOR_A, TENANT_A, CITIZEN_ROLES) })).statusCode === 200);

    const complete = await app.inject({ method: "POST", url: `/v1/crematorium/bookings/${id}/complete`, headers: hdr(ACTOR_A, TENANT_A, ADMIN_ROLES) });
    expect(complete.statusCode).toBe(422);
  });

  it("cancel: a citizen can cancel their OWN requested booking", async () => {
    const facilityId = await createActiveFacility();
    const create = await app.inject({ method: "POST", url: "/v1/crematorium/bookings", headers: hdr(ACTOR_A, TENANT_A, CITIZEN_ROLES), payload: bookingBody(facilityId) });
    const id = (create.json() as { id: string }).id;
    await waitFor(async () => (await app.inject({ method: "GET", url: `/v1/crematorium/bookings/${id}`, headers: hdr(ACTOR_A, TENANT_A, CITIZEN_ROLES) })).statusCode === 200);

    const cancel = await app.inject({ method: "POST", url: `/v1/crematorium/bookings/${id}/cancel`, headers: hdr(ACTOR_A, TENANT_A, CITIZEN_ROLES) });
    expect(cancel.statusCode).toBe(202);
    await waitFor(async () => (await app.inject({ method: "GET", url: `/v1/crematorium/bookings/${id}`, headers: hdr(ACTOR_A, TENANT_A, CITIZEN_ROLES) })).json().data.status === "cancelled");
  });

  it("ownership: a DIFFERENT citizen cannot cancel someone else's booking (403), and staff still can", async () => {
    const facilityId = await createActiveFacility();
    const create = await app.inject({ method: "POST", url: "/v1/crematorium/bookings", headers: hdr(ACTOR_A, TENANT_A, CITIZEN_ROLES), payload: bookingBody(facilityId) });
    const id = (create.json() as { id: string }).id;
    await waitFor(async () => (await app.inject({ method: "GET", url: `/v1/crematorium/bookings/${id}`, headers: hdr(ACTOR_A, TENANT_A, ADMIN_ROLES) })).statusCode === 200);

    const otherCancel = await app.inject({ method: "POST", url: `/v1/crematorium/bookings/${id}/cancel`, headers: hdr(ACTOR_B, TENANT_A, CITIZEN_ROLES) });
    expect(otherCancel.statusCode).toBe(403);

    const stillRequested = (await app.inject({ method: "GET", url: `/v1/crematorium/bookings/${id}`, headers: hdr(ACTOR_A, TENANT_A, ADMIN_ROLES) })).json().data;
    expect(stillRequested.status).toBe("requested");

    const adminCancel = await app.inject({ method: "POST", url: `/v1/crematorium/bookings/${id}/cancel`, headers: hdr(ACTOR_B, TENANT_A, ADMIN_ROLES) });
    expect(adminCancel.statusCode).toBe(202);
  });

  it("ownership: a plain citizen's list view is scoped to bookings they created; staff see the full tenant list", async () => {
    const facilityId = await createActiveFacility();
    const create = await app.inject({ method: "POST", url: "/v1/crematorium/bookings", headers: hdr(ACTOR_A, TENANT_A, CITIZEN_ROLES), payload: bookingBody(facilityId) });
    const id = (create.json() as { id: string }).id;
    await waitFor(async () => (await app.inject({ method: "GET", url: `/v1/crematorium/bookings/${id}`, headers: hdr(ACTOR_A, TENANT_A, ADMIN_ROLES) })).statusCode === 200);

    const otherList = await app.inject({ method: "GET", url: "/v1/crematorium/bookings", headers: hdr(ACTOR_B, TENANT_A, CITIZEN_ROLES) });
    expect(otherList.json().data.find((b: { id: string }) => b.id === id)).toBeUndefined();

    const staffList = await app.inject({ method: "GET", url: "/v1/crematorium/bookings", headers: hdr(ACTOR_B, TENANT_A, ADMIN_ROLES) });
    expect(staffList.json().data.find((b: { id: string }) => b.id === id)).toBeDefined();
  });
});

/**
 * Direct, DB-level proof that bookings/repo.ts's updateStatus is a real
 * compare-and-swap, bypassing routes/consumers entirely so the guard itself
 * is what's under test.
 */
async function seedBooking(status: string, tenantId = TENANT_A): Promise<string> {
  const id = randomUUID();
  await runWithTenant(tenantId, () =>
    db.transaction(async (tx) => {
      const bookingNumber = `CREM/CASTEST/${new Date().getUTCFullYear()}/${String(await repo.nextBookingNumber(tx)).padStart(6, "0")}`;
      await repo.insertBooking(tx, {
        id,
        tenantId,
        bookingNumber,
        facilityId: randomUUID(), // bookings.facility_id carries no DB-level FK; direct-seed doesn't need a real facility row
        applicantName: "CAS Test Applicant",
        applicantPhone: "9876543210",
        deceasedName: "CAS Test Deceased",
        serviceType: "cremation",
        requestedDate: "2027-03-01",
        status,
        slotNumber: null,
        feeMinor: 50000n,
        currency: "INR",
        feePaid: false,
        paymentRef: null,
        completedAt: null,
        createdBy: ACTOR_A,
        updatedBy: ACTOR_A,
      });
    }),
  );
  return id;
}

function findAsTenantA(id: string) {
  return runWithTenant(TENANT_A, () => repo.findById(id, TENANT_A));
}

describe("bookings/repo.ts updateStatus — compare-and-swap guard", () => {
  it("rejects a transition whose fromStatuses does not include the row's actual current status, and leaves the row untouched", async () => {
    const id = await seedBooking("requested");
    const row = await runWithTenant(TENANT_A, () =>
      db.transaction((tx) => repo.updateStatus(tx, id, TENANT_A, "completed", ["confirmed"], ACTOR_A)),
    );
    expect(row).toBeNull();
    const current = await findAsTenantA(id);
    expect(current?.status).toBe("requested");
    expect(current?.version).toBe(1);
  });

  it("applies the transition when the row's current status IS in fromStatuses", async () => {
    const id = await seedBooking("requested");
    const row = await runWithTenant(TENANT_A, () =>
      db.transaction((tx) => repo.updateStatus(tx, id, TENANT_A, "confirmed", ["requested"], ACTOR_A)),
    );
    expect(row).not.toBeNull();
    const current = await findAsTenantA(id);
    expect(current?.status).toBe("confirmed");
    expect(current?.version).toBe(2);
  });

  it("rejects with an empty fromStatuses list (no source status is ever valid)", async () => {
    const id = await seedBooking("requested");
    const row = await runWithTenant(TENANT_A, () =>
      db.transaction((tx) => repo.updateStatus(tx, id, TENANT_A, "confirmed", [], ACTOR_A)),
    );
    expect(row).toBeNull();
    expect((await findAsTenantA(id))?.status).toBe("requested");
  });

  it("is tenant-scoped: a different tenant's session cannot CAS a row it does not own", async () => {
    const id = await seedBooking("requested", TENANT_A);
    const row = await runWithTenant(TENANT_B, () =>
      db.transaction((tx) => repo.updateStatus(tx, id, TENANT_B, "confirmed", ["requested"], ACTOR_A)),
    );
    expect(row).toBeNull();
    expect((await findAsTenantA(id))?.status).toBe("requested");
  });

  it("proves the guard holds under real concurrency: two updateStatus calls racing for the SAME row, both accepting the row's actual current status as their source — only the first to commit applies, the second (now stale) is rejected", async () => {
    // Two commands racing at the database level (both issued inside
    // Promise.all, so Postgres's own row-lock serializes them — exactly
    // what would happen for two consumers processing colliding messages).
    // Without the fromStatuses predicate, BOTH updates would match the row
    // regardless of commit order, and the row would end up in whichever
    // status committed last — not a rejection, a silent clobber.
    //
    // Both racing writers accept fromStatuses=["confirmed"] (the row's
    // actual seeded status) rather than one "valid" and one "invalid"
    // source: a blocked UPDATE re-evaluates its WHERE clause against the
    // row's state AFTER the other commits, so racing genuinely-different
    // fromStatuses does not reliably prove mutual exclusion (whichever
    // "invalid" writer's fromStatuses happens to include the post-commit
    // status would legitimately also apply). Racing two IDENTICAL
    // fromStatuses is the correct proof: once either commits, the row
    // leaves "confirmed" for good, so the loser's re-check genuinely fails.
    const id = await seedBooking("confirmed");

    const [toCompleted, toCancelled] = await Promise.all([
      runWithTenant(TENANT_A, () => db.transaction((tx) => repo.updateStatus(tx, id, TENANT_A, "completed", ["confirmed"], ACTOR_A))),
      runWithTenant(TENANT_A, () => db.transaction((tx) => repo.updateStatus(tx, id, TENANT_A, "cancelled", ["confirmed"], ACTOR_A))),
    ]);

    const applied = [toCompleted, toCancelled].filter((r) => r !== null);
    expect(applied).toHaveLength(1);

    const row = await findAsTenantA(id);
    expect(row?.version).toBe(2);
    expect(["completed", "cancelled"]).toContain(row?.status);
  });
});

describe("booking number generation — no collisions under concurrency", () => {
  it("reserves 50 distinct sequence values when called concurrently", async () => {
    const results = await Promise.all(
      Array.from({ length: 50 }, () => db.transaction((tx) => repo.nextBookingNumber(tx))),
    );
    expect(new Set(results).size).toBe(50);
  });

  it("50 concurrent POST /v1/crematorium/bookings all succeed and persist 50 distinct booking_numbers — zero UNIQUE-constraint failures", async () => {
    const facilityId = await createActiveFacility();
    const responses = await Promise.all(
      Array.from({ length: 50 }, () =>
        app.inject({
          method: "POST",
          url: "/v1/crematorium/bookings",
          headers: hdr(randomUUID(), TENANT_A, CITIZEN_ROLES),
          payload: bookingBody(facilityId),
        }),
      ),
    );
    for (const res of responses) expect(res.statusCode).toBe(202);
    await drainQueue();
    await new Promise((r) => setTimeout(r, 200));
    await drainQueue();

    const ids = responses.map((r) => (r.json() as { id: string }).id);
    const numbers = await Promise.all(ids.map((id) => runWithTenant(TENANT_A, () => repo.findById(id, TENANT_A)).then((row) => row?.bookingNumber)));
    expect(numbers.every((n) => typeof n === "string")).toBe(true);
    expect(new Set(numbers).size).toBe(50); // every one is unique — no dropped/collided inserts
  });
});
