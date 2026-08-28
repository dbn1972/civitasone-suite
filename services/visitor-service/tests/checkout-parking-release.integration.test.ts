/**
 * Regression test (2026-08-27 deep-verify): checking out a visitor never
 * released their allocated parking slot.
 *
 * `modules/vehicle-pass/commands.ts#parkingSlotRelease` — the command
 * publisher, its consumer, and the DB update that frees the slot — all
 * already existed and were already tested (see vehicle-pass-consumer
 * .integration.test.ts), and its own doc comment claims it is "triggered
 * on visitor checkout" (Requirement 14.5). It was not: a repo-wide grep
 * for `parkingSlotRelease(` found exactly one caller anywhere in the
 * service, `modules/visit-request/no-show-worker.ts`'s automatic no-show
 * sweep (which hand-rolls a transactional `enqueue(tx, {topic:
 * COMMANDS.parkingSlotRelease, ...})` rather than calling the shared
 * function, because it needs the release to commit atomically with the
 * no_show transition). `modules/check-in/consumer.ts`'s checkOutRecord
 * handler — the everyday, expected way a visit ends — never called it at
 * all, so a slot allocated to a vehicle pass stayed marked occupied
 * forever once the visitor checked out normally.
 *
 * Fix: checkOutRecord now calls the new
 * `vehicle-pass/commands.ts#releaseParkingIfAllocated` helper as a
 * post-commit best-effort step, the same pattern already used for
 * evacuation-roster removal immediately above it in the same handler.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { runWithTenant } from "@civitasone/db";
import { db, scopedRead } from "../src/shared/db.js";
// The real shared queue singleton, NOT a fresh local MemoryQueue --
// releaseParkingIfAllocated (via vehicle-pass/commands.ts#parkingSlotRelease)
// publishes on this exact singleton, same as every other command
// publisher in this service; worker.ts registers every module's
// consumer on it for the same reason. A fresh local queue would never
// see that publish no matter what's registered on it.
import { queue } from "../src/shared/infra.js";
import { registerCheckInConsumers } from "../src/modules/check-in/consumer.js";
import { registerVehiclePassConsumers } from "../src/modules/vehicle-pass/consumer.js";
import { COMMANDS } from "../src/topics.js";
import { locations, gates, parkingSlots } from "../src/modules/location/schema.js";
import { visitRequests } from "../src/modules/visit-request/schema.js";
import { digitalPasses } from "../src/modules/digital-pass/schema.js";
import { vehiclePasses } from "../src/modules/vehicle-pass/schema.js";
import { checkIns } from "../src/modules/check-in/schema.js";

const TENANT = randomUUID();
const LOCATION = randomUUID();
const GATE = randomUUID();
const ACTOR = randomUUID();
const HOST = randomUUID();
const VISIT_REQUEST_ID = randomUUID();
const PASS_ID = randomUUID();
const VEHICLE_PASS_ID = randomUUID();
const PARKING_SLOT_ID = randomUUID();

const BUSINESS_HOURS = {
  mon: null, tue: null, wed: null, thu: null, fri: null, sat: null, sun: null,
} as const;

beforeAll(async () => {
  await runWithTenant(TENANT, () =>
    db.transaction(async (tx) => {
      await tx.insert(locations).values({
        id: LOCATION, tenantId: TENANT, name: "Checkout-Parking-Release Test Loc",
        businessHours: BUSINESS_HOURS, createdBy: ACTOR, updatedBy: ACTOR,
      });
      await tx.insert(gates).values({
        id: GATE, tenantId: TENANT, locationId: LOCATION, name: "Checkout-Parking-Release Test Gate",
        createdBy: ACTOR, updatedBy: ACTOR,
      });
      await tx.insert(parkingSlots).values({
        id: PARKING_SLOT_ID, tenantId: TENANT, locationId: LOCATION,
        slotNumber: "AUDIT-1", category: "standard", vehicleType: "car",
        occupied: true, occupiedBy: VEHICLE_PASS_ID,
      });
      await tx.insert(visitRequests).values({
        id: VISIT_REQUEST_ID, tenantId: TENANT, locationId: LOCATION,
        hostEmployeeId: HOST, status: "approved",
        visitorName: "AUDIT Checkout-Parking Visitor", visitorPhone: "+919900044466",
        createdBy: ACTOR, updatedBy: ACTOR,
      });
      await tx.insert(digitalPasses).values({
        id: PASS_ID, tenantId: TENANT, visitRequestId: VISIT_REQUEST_ID,
        locationId: LOCATION, passNumber: "CPR" + Math.floor(Math.random() * 1e6),
        passType: "single", status: "checked_in", qrJwt: "audit.fixture.jwt",
        validFrom: new Date(), validUntil: new Date(Date.now() + 86_400_000),
        createdBy: ACTOR, updatedBy: ACTOR,
      });
      await tx.insert(vehiclePasses).values({
        id: VEHICLE_PASS_ID, tenantId: TENANT, passId: PASS_ID, locationId: LOCATION,
        registrationNumber: "AUDIT-CPR-01", vehicleType: "car", status: "checked_in",
        parkingSlotId: PARKING_SLOT_ID,
        driverName: "AUDIT Checkout-Parking Visitor", createdBy: ACTOR, updatedBy: ACTOR,
      });
    }),
  );
});

afterAll(async () => {
  await runWithTenant(TENANT, () =>
    db.transaction(async (tx) => {
      await tx.delete(checkIns).where(eq(checkIns.passId, PASS_ID));
      await tx.delete(vehiclePasses).where(eq(vehiclePasses.id, VEHICLE_PASS_ID));
      await tx.delete(digitalPasses).where(eq(digitalPasses.id, PASS_ID));
      await tx.delete(visitRequests).where(eq(visitRequests.id, VISIT_REQUEST_ID));
      await tx.delete(parkingSlots).where(eq(parkingSlots.id, PARKING_SLOT_ID));
      await tx.delete(gates).where(eq(gates.id, GATE));
      await tx.delete(locations).where(eq(locations.id, LOCATION));
    }),
  );
});

describe("checkOutRecord -> parking slot release", () => {
  it("releases the vehicle's parking slot once the visitor checks out", async () => {
    registerCheckInConsumers(queue);
    registerVehiclePassConsumers(queue);

    await queue.publish(COMMANDS.checkOutRecord, {
      type: COMMANDS.checkOutRecord,
      tenantId: TENANT,
      actorId: ACTOR,
      correlationId: `corr-checkout-${randomUUID()}`,
      schemaVersion: "1.0",
      payload: { passId: PASS_ID, gateId: GATE },
    });
    await queue.drain();

    const [slot] = await runWithTenant(TENANT, () =>
      scopedRead((tx) => tx.select().from(parkingSlots).where(eq(parkingSlots.id, PARKING_SLOT_ID))),
    );
    const [vp] = await runWithTenant(TENANT, () =>
      scopedRead((tx) => tx.select().from(vehiclePasses).where(eq(vehiclePasses.id, VEHICLE_PASS_ID))),
    );

    expect(slot?.occupied).toBe(false);
    expect(slot?.occupiedBy).toBeNull();
    expect(vp?.status).toBe("checked_out");
  });
});
